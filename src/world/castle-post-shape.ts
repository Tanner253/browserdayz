// The signals post on the fort (src/sim/castle-post.ts): the shapes of what is made by hand, as plain numbers. Nothing
// of the card is here: src/world/castle-post.ts gives them their stuff and stands them in the world, and a test
// reads them as they are (test/castle-post.test.ts). Each corner carries where it is, the way it faces, where on
// its picture it is, its colour, and for the snow whether the sky is over it (the fort's own answer: `castleSky`).

import { CASTLE_SCALE, castleGround, type Loose } from '../sim/castle';
import { BODILY, GRAVE, POST, postMade, type Made } from '../sim/castle-post';
import { castleSky } from './castle-shape';

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const UP: V3 = [0, 1, 0];
/** the way a thing turned `yaw` faces along its own x, and along its own z */
const along = (yaw: number): V3 => [Math.cos(yaw), 0, -Math.sin(yaw)];
const across = (yaw: number): V3 => [Math.sin(yaw), 0, Math.cos(yaw)];
const rnd = (i: number, j = 0) => { let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + 974711) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** a slow unevenness, 0..1, the same wherever it is asked */
const cloud = (x: number, z: number) => {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, a = rnd(i, j), b = rnd(i + 1, j), c = rnd(i, j + 1), d = rnd(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

/** the colours things are painted: plain numbers, as light falls on them by day */
const PAINT = {
  burlap: [0.5, 0.44, 0.32] as V3, canvas: [0.3, 0.33, 0.22] as V3, tarp: [0.27, 0.31, 0.25] as V3, ticking: [0.42, 0.44, 0.47] as V3, blanket: [0.26, 0.29, 0.22] as V3,
  flag: [0.5, 0.1, 0.08] as V3, net: [0.92, 0.95, 0.88] as V3, timber: [0.33, 0.27, 0.2] as V3, board: [0.38, 0.33, 0.26] as V3, steel: [0.4, 0.42, 0.43] as V3,
  red: [0.5, 0.13, 0.1] as V3, white: [0.74, 0.74, 0.71] as V3, rubber: [0.035, 0.035, 0.04] as V3, iron: [0.11, 0.105, 0.1] as V3, drab: [0.2, 0.24, 0.16] as V3,
  ochre: [0.62, 0.45, 0.1] as V3, paper: [0.8, 0.77, 0.62] as V3, earth: [0.27, 0.24, 0.2] as V3, glass: [0.75, 0.76, 0.7] as V3, pot: [0.33, 0.34, 0.35] as V3,
};

/**
 * THE DAY ON IT, AND ITS SNOW: the fort's own number, asked of the fort corner by corner (`castleSky`: how much of
 * the day reaches a place, 1 under the sky, 0 to about a half under cover). The fort's stone look (`stoneLook`)
 * dims the sky's light by it and lays snow only where it is over 0.7. So nothing of the post is ever given more
 * than the fort says; what is under the sky and keeps its snow is given 1; and what is under the sky and sheds it
 * (the bars of the mast, a flag, the bare patches of a tarpaulin) is given OPEN, just under where snow begins.
 */
const OPEN = 0.69;

/** a skin: rows of numbers for the card. `sky`: the most of the day that reaches what is being made now, whatever the fort says of the place (under canvas, say); unsaid, what the fort says */
export class Skin {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  snow: number[] = [];
  sky: number | null = null;
  /** how much of the snow that falls on it stays, 0 to 1: less on what sheds it (the round of a sandbag), none on a bar or a flag */
  holds = 1;
  /** or it stays in patches a pace across (a tarpaulin the wind has had): the share of the cloth that keeps it, 0 for no patches */
  patchy = 0;
  /** what is being made now is a body's, about this spot: each corner of it is set down nearer the spot by the fort's scale (see `postShape`) */
  about: V3 | null = null;
  get triangles() { return this.pos.length / 9; }
  private put(p: V3, n: V3, u: [number, number], c: V3) {
    const o = this.about;
    if (o) p = [o[0] + (p[0] - o[0]) / CASTLE_SCALE, o[1] + (p[1] - o[1]) / CASTLE_SCALE, o[2] + (p[2] - o[2]) / CASTLE_SCALE];
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u[0], u[1]);
    // (a colour is said as the eye sees it; the card is given it as light)
    this.col.push(Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2));
    const day = Math.min(castleSky(p, n), this.sky ?? 1), keeps = this.patchy ? (cloud(p[0] * 1.1 + p[1] * 0.7, p[2] * 1.1) < this.patchy ? 1 : 0) : this.holds;
    this.snow.push(day >= 1 ? OPEN + (1 - OPEN) * keeps : day, 9);
  }
  tri(p: [V3, V3, V3], n: [V3, V3, V3], u: [[number, number], [number, number], [number, number]], c: V3) {
    for (let k = 0; k < 3; k++) this.put(p[k], n[k], u[k], c);
  }
  /** four corners in order round it, seen from the side it faces */
  quad(p: [V3, V3, V3, V3], c: V3, u: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]], n?: [V3, V3, V3, V3]) {
    const f = unit(cross(sub(p[1], p[0]), sub(p[3], p[0]))), m = n ?? [f, f, f, f];
    this.tri([p[0], p[1], p[2]], [m[0], m[1], m[2]], [u[0] as [number, number], u[1] as [number, number], u[2] as [number, number]], c);
    this.tri([p[0], p[2], p[3]], [m[0], m[2], m[3]], [u[0] as [number, number], u[2] as [number, number], u[3] as [number, number]], c);
  }
  /** three corners of something flat that faces `want` */
  face(a: V3, b: V3, c: V3, want: V3, col: V3) {
    const n = unit(cross(sub(b, a), sub(c, a))), ok = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] > 0, f = ok ? n : mul(n, -1);
    this.tri(ok ? [a, b, c] : [a, c, b], [f, f, f], [[0, 0], [1.5, 0], [0.75, 1.5]], col);
  }
  /** a block: its middle, its three ways, half its size each way. `open`: no underside */
  box(c: V3, ax: V3, ay: V3, az: V3, h: V3, col: V3, open = false) {
    const faces: [V3, V3, V3, number, number, number][] = [[ax, ay, az, h[0], h[1], h[2]], [ay, az, ax, h[1], h[2], h[0]], [az, ax, ay, h[2], h[0], h[1]], [mul(ax, -1), az, ay, h[0], h[2], h[1]], [mul(ay, -1), ax, az, h[1], h[0], h[2]], [mul(az, -1), ay, ax, h[2], h[1], h[0]]];
    faces.forEach(([n, u, v, hn, hu, hv], k) => {
      if (open && k === 4) return;
      const o = add(c, mul(n, hn)), at = (su: number, sv: number): V3 => add(o, add(mul(u, su * hu), mul(v, sv * hv)));
      this.quad([at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)], col, [[0, 0], [hu * 4, 0], [hu * 4, hv * 4], [0, hv * 4]]);
    });
  }
  /** a timber or a bar from one spot to another, so wide and so deep */
  beam(a: V3, b: V3, w: number, h: number, col: V3) {
    const az = unit(sub(b, a)), ax = unit(cross(Math.abs(az[1]) > 0.98 ? [1, 0, 0] : UP, az)), ay = cross(az, ax);
    this.box(mul(add(a, b), 0.5), ax, ay, az, [w / 2, h / 2, len(sub(b, a)) / 2], col);
  }
  /** a round bar from one spot to another: no ends */
  tube(a: V3, b: V3, r0: number, r1: number, sides: number, col: V3) {
    const az = unit(sub(b, a)), ax = unit(cross(Math.abs(az[1]) > 0.98 ? [1, 0, 0] : UP, az)), ay = cross(az, ax);
    for (let k = 0; k < sides; k++) {
      const t0 = (k / sides) * Math.PI * 2, t1 = ((k + 1) / sides) * Math.PI * 2;
      const n0 = add(mul(ax, Math.cos(t0)), mul(ay, Math.sin(t0))), n1 = add(mul(ax, Math.cos(t1)), mul(ay, Math.sin(t1)));
      this.quad([add(a, mul(n0, r0)), add(a, mul(n1, r0)), add(b, mul(n1, r1)), add(b, mul(n0, r1))], col, [[0, 0], [0.2, 0], [0.2, 1], [0, 1]], [n0, n1, n1, n0]);
    }
  }
  /** a lid on a round bar's end */
  disc(c: V3, n: V3, r: number, sides: number, col: V3) {
    const ax = unit(cross(Math.abs(n[1]) > 0.98 ? [1, 0, 0] : UP, n)), ay = cross(n, ax);
    for (let k = 0; k < sides; k++) {
      const t0 = (k / sides) * Math.PI * 2, t1 = ((k + 1) / sides) * Math.PI * 2;
      this.tri([c, add(c, add(mul(ax, Math.cos(t0) * r), mul(ay, Math.sin(t0) * r))), add(c, add(mul(ax, Math.cos(t1) * r), mul(ay, Math.sin(t1) * r)))], [n, n, n], [[0.5, 0.5], [0, 0], [1, 0]], col);
    }
  }
  /** cloth over a grid of spots: `at(u, v)` for u and v from 0 to 1; its picture so many metres to a repeat */
  cloth(at: (u: number, v: number) => V3, nu: number, nv: number, col: (u: number, v: number) => V3, tile: number) {
    const P: V3[][] = [], N: V3[][] = [], U: [number, number][][] = [];
    for (let j = 0; j <= nv; j++) { P.push([]); for (let i = 0; i <= nu; i++) P[j].push(at(i / nu, j / nv)); }
    for (let j = 0; j <= nv; j++) {
      N.push([]);
      U.push([]);
      for (let i = 0; i <= nu; i++) {
        const du = sub(P[j][Math.min(nu, i + 1)], P[j][Math.max(0, i - 1)]), dv = sub(P[Math.min(nv, j + 1)][i], P[Math.max(0, j - 1)][i]);
        N[j].push(unit(cross(du, dv)));
        U[j].push([(len(sub(P[j][i], P[j][0])) + i * 1e-4) / tile, (len(sub(P[j][i], P[0][i])) + j * 1e-4) / tile]);
      }
    }
    // (the side of it that is up is its face: snow lies on that side, and light falls on it as on a thing that faces up)
    const flip = N[nv >> 1][nu >> 1][1] < 0;
    if (flip) for (const row of N) for (let i = 0; i < row.length; i++) row[i] = mul(row[i], -1);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const c = col((i + 0.5) / nu, (j + 0.5) / nv);
      if (flip) this.quad([P[j][i], P[j + 1][i], P[j + 1][i + 1], P[j][i + 1]], c, [U[j][i], U[j + 1][i], U[j + 1][i + 1], U[j][i + 1]], [N[j][i], N[j + 1][i], N[j + 1][i + 1], N[j][i + 1]]);
      else this.quad([P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]], c, [U[j][i], U[j][i + 1], U[j + 1][i + 1], U[j + 1][i]], [N[j][i], N[j][i + 1], N[j + 1][i + 1], N[j + 1][i]]);
    }
  }
  /** a sandbag (or anything that lies as one does: a mound of earth): a block gone soft, no underside */
  bag(c: V3, yaw: number, h: V3, col: V3, seed: number, tilt = 0) {
    const ax0 = along(yaw), az = across(yaw), ax: V3 = unit([ax0[0], Math.sin(tilt), ax0[2]]), ay = unit(cross(az, ax));
    const soft = (q: V3): { p: V3; n: V3 } => {
      const s = unit(q), b = 0.55, k = 1 / (1 - b + b * 1.2), l: V3 = [(q[0] * (1 - b) + s[0] * b * 1.2) * k, (q[1] * (1 - b) + s[1] * b * 1.2) * k, (q[2] * (1 - b) + s[2] * b * 1.2) * k];
      // (it sags: fuller low down than at its top)
      const sag = 1 + 0.08 * (1 - l[1]);
      const p = add(c, add(add(mul(ax, l[0] * h[0] * sag), mul(ay, l[1] * h[1])), mul(az, l[2] * h[2] * sag)));
      const n = unit(add(add(mul(ax, s[0] / h[0]), mul(ay, s[1] / h[1])), mul(az, s[2] / h[2])));
      return { p, n };
    };
    const face = (o: V3, u: V3, v: V3, nu: number, nv: number) => {
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const q = (a: number, b: number) => soft(add(o, add(mul(u, (a / nu) * 2 - 1), mul(v, (b / nv) * 2 - 1)))), k = [q(i, j), q(i + 1, j), q(i + 1, j + 1), q(i, j + 1)];
        const t = (a: number, b: number): [number, number] => [(a / nu) * 1.6 + seed * 0.37, (b / nv) * 1.1 + seed * 0.61];
        this.quad([k[0].p, k[1].p, k[2].p, k[3].p], col, [t(i, j), t(i + 1, j), t(i + 1, j + 1), t(i, j + 1)], [k[0].n, k[1].n, k[2].n, k[3].n]);
      }
    };
    face([0, 1, 0], [0, 0, 1], [1, 0, 0], 2, 3);
    face([1, 0, 0], [0, 1, 0], [0, 0, 1], 2, 2);
    face([-1, 0, 0], [0, 0, 1], [0, 1, 0], 2, 2);
    face([0, 0, 1], [1, 0, 0], [0, 1, 0], 3, 2);
    face([0, 0, -1], [0, 1, 0], [1, 0, 0], 2, 3);
  }
}

export interface Skins { hard: Skin; cloth: Skin; net: Skin; glow: Skin }

/** the mast from far off: a plain pole of three sides, banded as the lattice is */
export function farMast(k: Skin, at: V3, h: number) {
  const M = POST.mast, r = M.side / Math.sqrt(3), bands = 6;
  k.holds = 0;
  for (let b = 0; b < bands; b++) {
    const y0 = at[1] + (h * b) / bands, y1 = at[1] + (h * (b + 1)) / bands, col = b % 2 ? PAINT.white : PAINT.red;
    for (let s = 0; s < 3; s++) {
      const a0 = (Math.PI / 2) + (s * Math.PI * 2) / 3, a1 = a0 + (Math.PI * 2) / 3, p0: V3 = [at[0] + Math.cos(a0) * r, 0, at[2] + Math.sin(a0) * r], p1: V3 = [at[0] + Math.cos(a1) * r, 0, at[2] + Math.sin(a1) * r];
      k.quad([[p1[0], y0, p1[2]], [p0[0], y0, p0[2]], [p0[0], y1, p0[2]], [p1[0], y1, p1[2]]], col);
    }
  }
  k.tube([at[0], at[1] + h, at[2]], [at[0], at[1] + h + 2.6, at[2]], 0.03, 0.02, 3, PAINT.steel);
  k.holds = 1;
}

/** Everything of the post that is made by hand, as skins. @param g the ground over the terrace at a spot (for what stands on it) */
export function postShape(made: Made[], g: (x: number, z: number) => number = castleGround): Skins {
  const hard = new Skin(), cloth = new Skin(), net = new Skin(), glow = new Skin(), skins = [hard, cloth, net, glow];
  // (a sandbag is a body's: a wall of them is as long as its line, of bags the size a bag is)
  const BG = { long: POST.bag.long / CASTLE_SCALE, wide: POST.bag.wide / CASTLE_SCALE, course: POST.bag.course / CASTLE_SCALE };
  let n = 0;
  for (const m of made) {
    n++;
    // A BODY'S (see src/sim/castle-post.ts): it is made below at the size it is said, in metres; and the whole post
    // is drawn a fifth bigger, with the fort. So each corner of it is set down that much nearer its own spot: its
    // place is the fort's, its size its own.
    const own: V3 | null = BODILY.has(m.t) && 'at' in m ? (m.t === 'grave' ? [m.at[0], g(m.at[0], m.at[2]), m.at[2]] : m.at) : null;
    for (const k of skins) k.about = own;
    if (m.t === 'mast') {
      // three legs, a rung and a brace on each side every metre, banded red and white; aerials at its head; guys to their pegs
      const M = POST.mast, r = M.side / Math.sqrt(3), leg = (s: number, y: number): V3 => [m.at[0] + Math.cos(Math.PI / 2 + (s * Math.PI * 2) / 3) * r, m.at[1] + y, m.at[2] + Math.sin(Math.PI / 2 + (s * Math.PI * 2) / 3) * r];
      const bays = Math.round(m.h / M.bay);
      hard.holds = 0;
      for (let b = 0; b < bays; b++) {
        const y0 = b * M.bay, y1 = y0 + M.bay, col = Math.floor(b / 2) % 2 ? PAINT.white : PAINT.red;
        for (let s = 0; s < 3; s++) {
          hard.tube(leg(s, y0), leg(s, y1), 0.026, 0.026, 4, col);
          hard.tube(leg(s, y1), leg((s + 1) % 3, y1), 0.013, 0.013, 3, col);
          hard.tube(b % 2 ? leg(s, y0) : leg((s + 1) % 3, y0), b % 2 ? leg((s + 1) % 3, y1) : leg(s, y1), 0.012, 0.012, 3, col);
        }
      }
      hard.holds = 1;
      hard.box([m.at[0], m.at[1] + 0.04, m.at[2]], [1, 0, 0], UP, [0, 0, 1], [0.42, 0.04, 0.42], PAINT.iron);
      const top = m.h;
      hard.holds = 0;
      // a whip at its head and its lamp; two arms of dipoles under that
      hard.tube([m.at[0], m.at[1] + top, m.at[2]], [m.at[0], m.at[1] + top + 2.8, m.at[2]], 0.016, 0.006, 3, PAINT.steel);
      hard.box([m.at[0], m.at[1] + top + POST.mast.light - 0.1, m.at[2]], [1, 0, 0], UP, [0, 0, 1], [0.07, 0.09, 0.07], PAINT.red);
      for (const [y, yaw] of [[top - 0.9, 0.5], [top - 2.6, 2.1]]) {
        const d = along(yaw), a = add([m.at[0], m.at[1] + y, m.at[2]], mul(d, -1.1)), b = add([m.at[0], m.at[1] + y, m.at[2]], mul(d, 1.1));
        hard.tube(a, b, 0.014, 0.014, 3, PAINT.steel);
        for (const e of [a, b, mix(a, b, 0.3), mix(a, b, 0.7)]) hard.tube(add(e, [0, -0.45, 0]), add(e, [0, 0.45, 0]), 0.009, 0.009, 3, PAINT.steel);
      }
      // (two guys come down to each peg, from two heights: the peg is made once. Made for each guy it was one block twice in one place.)
      const pegs = new Set<string>();
      for (const guy of m.guys) {
        const from: V3 = [m.at[0], m.at[1] + guy.from, m.at[2]], peg = guy.to.map((v) => v.toFixed(2)).join();
        hard.tube(from, guy.to, 0.007, 0.007, 3, PAINT.iron);
        if (!pegs.has(peg)) hard.box(add(guy.to, [0, 0.05, 0]), [1, 0, 0], UP, [0, 0, 1], [0.05, 0.05, 0.05], PAINT.iron);
        pegs.add(peg);
      }
      hard.holds = 1;
    } else if (m.t === 'bags') {
      cloth.holds = 0.85;
      for (let s = 0; s + 1 < m.pts.length; s++) {
        const [ax, az] = m.pts[s], [bx, bz] = m.pts[s + 1], long = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax), count = Math.max(1, Math.round(long / BG.long));
        for (let c = 0; c < m.courses; c++) {
          // (laid as bricks are: each course half a bag along from the one under it)
          const row = c % 2 && count > 1 ? count - 1 : count, each = long / count, off = c % 2 && count > 1 ? each : each / 2;
          for (let k = 0; k < row; k++) {
            const t = (off + k * each) / long, id = n * 131 + s * 17 + c * 7 + k, x = ax + (bx - ax) * t + (rnd(id, 1) - 0.5) * 0.04, z = az + (bz - az) * t + (rnd(id, 2) - 0.5) * 0.04;
            const y = (m.sits ? g(x, z) : 0) + m.y + (c + 0.5) * BG.course, tone = (0.82 + rnd(id, 3) * 0.26) * (c === 0 ? 0.88 : 1);
            cloth.bag([x, y, z], yaw + (rnd(id, 4) - 0.5) * 0.16, [Math.min(each, BG.long * 1.15) / 2 + 0.012, BG.course / 2 + 0.012, BG.wide / 2], mul(PAINT.burlap, tone), id, (rnd(id, 5) - 0.5) * 0.08);
          }
        }
      }
      cloth.holds = 1;
    } else if (m.t === 'sheet') {
      const [a, b, c, d] = m.p, k = m.stuff === 'net' ? net : cloth, fine = m.stuff === 'flag' ? 5 : 8;
      const at = (u: number, v: number): V3 => {
        const p = mix(mix(a, b, u), mix(d, c, u), v), dip = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
        // (it hangs between its corners; a net is uneven with it, and a flag hangs in folds from its pole)
        const rough = m.stuff === 'net' ? (rnd(Math.round(u * fine) + n * 31, Math.round(v * fine)) - 0.5) * 0.09 * (dip > 0.05 ? 1 : 0) : 0;
        if (m.stuff === 'flag') return add(p, [Math.sin(u * 7 + v * 2) * 0.06 * u, -m.sag * u * u, Math.cos(u * 9) * 0.05 * u]);
        return add(p, [0, -m.sag * dip + rough, 0]);
      };
      const base = m.stuff === 'net' ? PAINT.net : m.stuff === 'flag' ? PAINT.flag : PAINT.tarp;
      // (snow stays on a net in clumps, and on a tarpaulin in patches the wind has left; none on a flag)
      k.patchy = m.stuff === 'net' ? 0.5 : m.stuff === 'tarp' ? 0.56 : 0;
      k.holds = m.stuff === 'flag' ? 0 : 1;
      const spread = m.stuff === 'net' ? 0.26 : 0.07;
      k.cloth(at, fine, fine, (u, v) => mul(base, 1 - spread / 2 + rnd(Math.floor(u * fine) + n * 7, Math.floor(v * fine)) * spread), m.stuff === 'net' ? 1.5 : 0.6);
      k.patchy = 0;
      k.holds = 1;
    } else if (m.t === 'boards') {
      // duckboards: in lengths of a pace and a half, each two runners and its slats, none quite in line with the next
      const run = sub(m.b, m.a), long = len(run), d = unit(run), w: V3 = unit(cross(d, UP)), panels = Math.max(1, Math.round(long / 1.5)), each = long / panels;
      for (let p = 0; p < panels; p++) {
        const skew = (rnd(n, p) - 0.5) * 0.06, dd = unit(add(d, mul(w, skew))), ww = unit(cross(dd, UP)), a0 = add(add(m.a, mul(d, p * each + 0.03)), mul(w, (rnd(n, p + 40) - 0.5) * 0.05)), b0 = add(a0, mul(dd, each - 0.06));
        for (const side of [-1, 1]) hard.beam(add(add(a0, mul(ww, side * (m.w / 2 - 0.07))), [0, 0.025, 0]), add(add(b0, mul(ww, side * (m.w / 2 - 0.07))), [0, 0.025, 0]), 0.06, 0.05, mul(PAINT.timber, 0.9));
        const slats = Math.floor((each - 0.06) / 0.135);
        for (let s = 0; s < slats; s++) {
          const c = add(add(a0, mul(dd, 0.06 + s * 0.135)), [0, 0.065, 0]);
          hard.box(c, dd, UP, ww, [0.05, 0.015, m.w / 2], mul(PAINT.board, 0.8 + rnd(n * 9 + p, s) * 0.35), true);
        }
      }
    } else if (m.t === 'cable') {
      const r = m.r ?? 0.011, sides = m.r ? 8 : 4, col = m.r ? PAINT.iron : PAINT.rubber;
      // (it hangs over the longest of its lengths, if it is said to hang)
      let longest = -1;
      if (m.sag) for (let s = 0, best = 0; s + 1 < m.pts.length; s++) if (len(sub(m.pts[s + 1], m.pts[s])) > best) { best = len(sub(m.pts[s + 1], m.pts[s])); longest = s; }
      for (let s = 0; s + 1 < m.pts.length; s++) {
        const a = m.pts[s], b = m.pts[s + 1];
        if (s !== longest) { hard.tube(a, b, r, r, sides, col); continue; }
        for (let k = 0; k < 8; k++) {
          const at = (t: number): V3 => add(mix(a, b, t), [0, -m.sag! * 4 * t * (1 - t), 0]);
          hard.tube(at(k / 8), at((k + 1) / 8), r, r, sides, col);
        }
      }
    } else if (m.t === 'pole') {
      hard.tube(m.a, m.b, m.r, m.r * 0.9, 6, m.stuff === 'steel' ? PAINT.white : mul(PAINT.timber, 0.85 + rnd(n) * 0.3));
      if (m.stuff === 'steel') hard.box(add(m.b, [0, 0.05, 0]), [1, 0, 0], UP, [0, 0, 1], [0.05, 0.05, 0.05], PAINT.ochre);
    } else if (m.t === 'flood') {
      // a lamp in a housing on a yoke, looking a little down; on three legs of its own where it is said to stand
      const yaw = (-m.aim * Math.PI) / 180, f0 = along(yaw), f: V3 = unit([f0[0], -0.32, f0[2]]), side = mul(across(yaw), -1), up = unit(cross(f, side));
      hard.box(m.at, side, up, f, [0.17, 0.13, 0.09], PAINT.drab);
      const lens = add(m.at, mul(f, 0.092)), q = (su: number, sv: number): V3 => add(lens, add(mul(side, su * 0.14), mul(up, sv * 0.1)));
      hard.quad([q(-1, -1), q(1, -1), q(1, 1), q(-1, 1)], PAINT.glass);
      const l2 = add(m.at, mul(f, 0.094)), q2 = (su: number, sv: number): V3 => add(l2, add(mul(side, su * 0.14), mul(up, sv * 0.1)));
      glow.quad([q2(-1, -1), q2(1, -1), q2(1, 1), q2(-1, 1)], [1, 0.95, 0.82]);
      for (const s of [-1, 1]) hard.beam(add(m.at, mul(side, s * 0.19)), add(add(m.at, mul(side, s * 0.19)), [0, -0.24, 0]), 0.025, 0.04, PAINT.iron);
      hard.beam(add(add(m.at, mul(side, -0.2)), [0, -0.24, 0]), add(add(m.at, mul(side, 0.2)), [0, -0.24, 0]), 0.04, 0.025, PAINT.iron);
      if (m.foot !== undefined) {
        const hub: V3 = [m.at[0], m.foot + 0.95, m.at[2]];
        hard.tube(hub, [m.at[0], m.at[1] - 0.24, m.at[2]], 0.02, 0.018, 5, PAINT.steel);
        for (let k = 0; k < 3; k++) hard.tube([m.at[0] + Math.cos(k * 2.094 + 0.4) * 0.5, m.foot, m.at[2] + Math.sin(k * 2.094 + 0.4) * 0.5], hub, 0.016, 0.016, 4, PAINT.steel);
      }
    } else if (m.t === 'generator') {
      // an engine and its dynamo in a frame of tube, a tank over them, a panel at one end, on two skids
      const d = along(m.yaw), w = across(m.yaw), P = (lx: number, y: number, lz: number): V3 => add(m.at, add(add(mul(d, lx), mul(w, lz)), [0, y, 0]));
      for (const sz of [-1, 1]) {
        hard.beam(P(-0.52, 0.03, sz * 0.24), P(0.52, 0.03, sz * 0.24), 0.07, 0.06, PAINT.iron);
        for (const sx of [-1, 1]) hard.tube(P(sx * 0.48, 0.06, sz * 0.27), P(sx * 0.48, 0.7, sz * 0.27), 0.018, 0.018, 4, PAINT.ochre);
        hard.tube(P(-0.48, 0.7, sz * 0.27), P(0.48, 0.7, sz * 0.27), 0.018, 0.018, 4, PAINT.ochre);
      }
      for (const sx of [-1, 1]) hard.tube(P(sx * 0.48, 0.7, -0.27), P(sx * 0.48, 0.7, 0.27), 0.018, 0.018, 4, PAINT.ochre);
      hard.box(P(-0.14, 0.3, 0), d, UP, w, [0.24, 0.2, 0.17], PAINT.drab);
      hard.box(P(-0.14, 0.53, 0.02), d, UP, w, [0.12, 0.05, 0.1], PAINT.iron);
      hard.tube(P(0.12, 0.28, 0), P(0.44, 0.28, 0), 0.14, 0.14, 8, mul(PAINT.steel, 0.7));
      hard.disc(P(0.44, 0.28, 0), d, 0.14, 8, mul(PAINT.steel, 0.6));
      hard.box(P(-0.05, 0.63, 0), d, UP, w, [0.3, 0.055, 0.19], PAINT.red);
      hard.tube(P(-0.05, 0.68, 0.08), P(-0.05, 0.72, 0.08), 0.03, 0.03, 6, PAINT.iron);
      hard.box(P(0.47, 0.5, 0), d, UP, w, [0.03, 0.12, 0.16], mul(PAINT.steel, 0.55));
      hard.tube(P(-0.36, 0.42, -0.1), P(-0.36, 0.86, -0.1), 0.022, 0.022, 5, PAINT.iron);
    } else if (m.t === 'scope') {
      const yaw = (-m.aim * Math.PI) / 180, f0 = along(yaw), f: V3 = unit([f0[0], -0.14, f0[2]]), hub: V3 = [m.at[0], m.at[1] + 1.18, m.at[2]];
      for (let k = 0; k < 3; k++) hard.tube([m.at[0] + Math.cos(k * 2.094 + 1) * 0.42, m.at[1], m.at[2] + Math.sin(k * 2.094 + 1) * 0.42], hub, 0.014, 0.014, 4, PAINT.timber);
      hard.box(add(hub, [0, 0.04, 0]), [1, 0, 0], UP, [0, 0, 1], [0.04, 0.04, 0.04], PAINT.iron);
      const a = add(add(hub, [0, 0.12, 0]), mul(f, -0.24)), b = add(add(hub, [0, 0.12, 0]), mul(f, 0.26));
      hard.tube(a, b, 0.03, 0.042, 8, PAINT.drab);
      hard.disc(b, f, 0.042, 8, [0.05, 0.07, 0.1]);
      hard.tube(add(a, mul(f, -0.07)), a, 0.018, 0.022, 6, PAINT.iron);
    } else if (m.t === 'table') {
      const d = along(m.yaw), w = across(m.yaw), P = (lx: number, y: number, lz: number): V3 => add(m.at, add(add(mul(d, lx), mul(w, lz)), [0, y, 0]));
      hard.box(P(0, m.h - 0.02, 0), d, UP, w, [m.w / 2, 0.02, m.d / 2], mul(PAINT.board, 0.95));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) hard.beam(P(sx * (m.w / 2 - 0.06), 0, sz * (m.d / 2 - 0.05)), P(sx * (m.w / 2 - 0.06), m.h - 0.04, sz * (m.d / 2 - 0.05)), 0.05, 0.05, PAINT.timber);
        hard.beam(P(sx * (m.w / 2 - 0.06), m.h * 0.35, -(m.d / 2 - 0.05)), P(sx * (m.w / 2 - 0.06), m.h * 0.35, m.d / 2 - 0.05), 0.03, 0.05, PAINT.timber);
      }
    } else if (m.t === 'set') {
      const d = along(m.yaw), w = across(m.yaw), P = (lx: number, y: number, lz: number): V3 => add(m.at, add(add(mul(d, lx), mul(w, lz)), [0, y, 0]));
      if (m.kind === 'radio') {
        hard.box(P(0, 0.14, 0), d, UP, w, [0.2, 0.14, 0.12], PAINT.drab);
        hard.box(P(0, 0.15, -0.122), d, UP, w, [0.17, 0.1, 0.004], PAINT.iron);
        for (const lx of [-0.1, 0, 0.1]) hard.box(P(lx, 0.12, -0.135), d, UP, w, [0.02, 0.02, 0.012], PAINT.steel);
        hard.tube(P(0.16, 0.28, 0.06), P(0.16, 0.95, 0.06), 0.006, 0.004, 3, PAINT.iron);
      } else {
        hard.box(P(0, 0.06, 0), d, UP, w, [0.12, 0.06, 0.08], PAINT.drab);
        hard.beam(P(-0.1, 0.145, 0), P(0.1, 0.145, 0), 0.04, 0.035, PAINT.iron);
        for (const lx of [-0.09, 0.09]) hard.box(P(lx, 0.13, 0), d, UP, w, [0.03, 0.02, 0.03], PAINT.iron);
      }
    } else if (m.t === 'map') {
      const d = along(m.yaw), w = across(m.yaw), P = (lx: number, lz: number, y = 0): V3 => add(m.at, add(add(mul(d, lx), mul(w, lz)), [0, y, 0]));
      hard.quad([P(-m.w / 2, m.d / 2), P(m.w / 2, m.d / 2), P(m.w / 2, -m.d / 2), P(-m.w / 2, -m.d / 2)], PAINT.paper);
      // (what is drawn on it: the valley's river, the road up, the fort ringed in red)
      const ink = (a: [number, number], b: [number, number], col: V3, wide = 0.012) => {
        const p = P(a[0], a[1], 0.0015), q = P(b[0], b[1], 0.0015), s = mul(unit(cross(UP, sub(q, p))), wide / 2);
        hard.quad([add(p, s), sub(p, s), sub(q, s), add(q, s)], col);
      };
      const river: [number, number][] = [[-0.55, -0.2], [-0.3, -0.05], [-0.05, -0.12], [0.2, 0.05], [0.5, 0.0]], road: [number, number][] = [[-0.5, 0.25], [-0.15, 0.18], [0.1, 0.24], [0.33, 0.12], [0.42, -0.12]];
      for (let k = 0; k + 1 < river.length; k++) ink(river[k], river[k + 1], [0.2, 0.33, 0.5], 0.02);
      for (let k = 0; k + 1 < road.length; k++) ink(road[k], road[k + 1], [0.25, 0.2, 0.14]);
      for (let k = 0; k < 8; k++) ink([0.42 + Math.cos(k * 0.785) * 0.07, -0.16 + Math.sin(k * 0.785) * 0.07], [0.42 + Math.cos((k + 1) * 0.785) * 0.07, -0.16 + Math.sin((k + 1) * 0.785) * 0.07], [0.6, 0.08, 0.06]);
    } else if (m.t === 'bedroll') {
      const d = along(m.yaw), w = across(m.yaw), P = (lx: number, y: number, lz: number): V3 => add(m.at, add(add(mul(d, lx), mul(w, lz)), [0, y, 0]));
      cloth.sky = 0.45;
      cloth.bag(P(0, 0.055, 0), m.yaw, [0.9, 0.055, 0.31], PAINT.ticking, n * 3);
      cloth.bag(P(-0.2, 0.1, 0), m.yaw, [0.55, 0.03, 0.33], PAINT.blanket, n * 5);
      cloth.bag(P(0.72, 0.13, 0), m.yaw + Math.PI / 2, [0.24, 0.06, 0.13], mul(PAINT.ticking, 1.15), n * 7);
      cloth.sky = null;
    } else if (m.t === 'grave') {
      // a mound of the hill's own stones and earth, and a cross of two rough timbers at its head
      const gy = g(m.at[0], m.at[2]), d = along(m.yaw), o: V3 = [m.at[0], gy, m.at[2]];
      hard.bag(add(o, [0, 0.1, 0]), m.yaw, [0.95, 0.24, 0.42], mul(PAINT.earth, 0.9 + rnd(n) * 0.25), n);
      for (let k = 0; k < 4; k++) hard.bag(add(o, add(mul(d, -0.6 + k * 0.4 + rnd(n, k) * 0.1), [0, 0.3, (rnd(n, k + 9) - 0.5) * 0.4])), m.yaw + rnd(n, k + 20) * 3, [0.13, 0.08, 0.1], [0.36, 0.36, 0.35], n + k);
      const at = add(o, mul(d, -GRAVE.cross)), foot: V3 = [at[0], g(at[0], at[2]), at[2]], lean: V3 = [(rnd(n, 31) - 0.5) * 0.12, GRAVE.high, (rnd(n, 32) - 0.5) * 0.12];
      // (the one a helmet is hung on stands straight)
      const head = add(foot, m.plumb ? [0, GRAVE.high, 0] : lean), w = across(m.yaw);
      hard.beam(add(foot, [0, -0.2, 0]), head, 0.07, 0.07, mul(PAINT.timber, 0.9));
      const bar = mix(foot, head, 0.72);
      hard.beam(add(bar, mul(w, -0.3)), add(bar, mul(w, 0.3)), 0.06, 0.06, mul(PAINT.timber, 1.05));
    } else if (m.t === 'pot') {
      hard.tube(m.at, add(m.at, [0, m.h, 0]), m.r, m.r * 1.04, 10, PAINT.pot);
      hard.disc(add(m.at, [0, m.h - 0.03, 0]), UP, m.r * 1.02, 10, mul(PAINT.pot, 0.35));
      for (const s of m.r > 0.06 ? [-1, 1] : [1]) hard.box(add(m.at, [s * m.r * 1.2, m.h * 0.75, 0]), [1, 0, 0], UP, [0, 0, 1], [m.r * 0.22, 0.006, m.r * 0.3], PAINT.iron);
    } else if (m.t === 'bulb') {
      hard.tube(add(m.at, [0, 0.06, 0]), add(m.at, [0, m.drop, 0]), 0.005, 0.005, 3, PAINT.rubber);
      hard.box(add(m.at, [0, 0.045, 0]), [1, 0, 0], UP, [0, 0, 1], [0.018, 0.025, 0.018], PAINT.iron);
      for (const [k, r] of [[hard, 0.036], [glow, 0.04]] as [Skin, number][]) {
        k.tube(add(m.at, [0, 0.02, 0]), m.at, 0.016, r, 6, k === hard ? PAINT.glass : [1, 0.82, 0.55]);
        k.tube(m.at, add(m.at, [0, -0.045, 0]), r, 0.012, 6, k === hard ? PAINT.glass : [1, 0.82, 0.55]);
      }
    } else if (m.t === 'tins') {
      // tins of ammunition: so many, two to a layer, none quite square to the next
      const d = along(m.yaw), w = across(m.yaw);
      for (let k = 0; k < m.n; k++) {
        const turn = m.yaw + (rnd(n, k) - 0.5) * 0.3, c = add(m.at, add(add(mul(d, (k % 2 ? 0.2 : -0.2) + (rnd(n, k + 5) - 0.5) * 0.04), mul(w, (rnd(n, k + 9) - 0.5) * 0.05)), [0, 0.09 + Math.floor(k / 2) * 0.18, 0]));
        hard.box(c, along(turn), UP, across(turn), [0.185, 0.085, 0.13], mul(PAINT.drab, 0.85 + rnd(n, k + 3) * 0.4), true);
        hard.box(add(c, [0, 0.09, 0]), along(turn), UP, across(turn), [0.19, 0.008, 0.135], mul(PAINT.drab, 0.7));
        hard.box(add(c, mul(across(turn), -0.133)), along(turn), UP, across(turn), [0.05, 0.03, 0.004], PAINT.ochre);
      }
    } else if (m.t === 'logs') {
      // split wood, stacked against a wall: so many across, so many high
      const d = along(m.yaw), w = across(m.yaw);
      for (let j = 0; j < m.high; j++) for (let i = 0; i < m.wide - (j % 2); i++) {
        const r = 0.055 + rnd(n * 7 + i, j) * 0.02, c = add(m.at, add(mul(d, (i - (m.wide - 1 - (j % 2)) / 2) * 0.135), [0, 0.07 + j * 0.115, 0])), a = add(c, mul(w, -0.2 - rnd(n + i, j + 3) * 0.04)), b = add(c, mul(w, 0.2 + rnd(n + i, j + 7) * 0.04));
        hard.tube(a, b, r, r, 5, mul(PAINT.timber, 0.8 + rnd(n + i, j + 11) * 0.5));
        hard.disc(b, w, r, 5, [0.62, 0.52, 0.36]);
        hard.disc(a, mul(w, -1), r, 5, [0.62, 0.52, 0.36]);
      }
    } else if (m.t === 'board') {
      // a board on a wall with a map pinned to it: it faces the way it is turned to (its own z)
      const d = along(m.yaw), f = across(m.yaw), P = (lx: number, y: number, out = 0): V3 => add(m.at, add(add(mul(d, lx), mul(f, out)), [0, y, 0]));
      hard.box(P(0, 0, 0.012), d, UP, f, [m.w / 2, m.h / 2, 0.012], mul(PAINT.board, 0.8));
      const sheet = (x0: number, x1: number, y0: number, y1: number, col: V3, out: number) => hard.quad([P(x0, y0, out), P(x1, y0, out), P(x1, y1, out), P(x0, y1, out)], col);
      sheet(-m.w / 2 + 0.06, m.w * 0.18, -m.h / 2 + 0.06, m.h / 2 - 0.06, PAINT.paper, 0.026);
      sheet(m.w * 0.22, m.w / 2 - 0.05, 0, m.h / 2 - 0.08, mul(PAINT.paper, 1.08), 0.026);
      sheet(m.w * 0.24, m.w / 2 - 0.1, -m.h / 2 + 0.07, -0.05, mul(PAINT.paper, 0.9), 0.026);
      // (what is marked on the map: the valley's river, and three rings in red pencil)
      const ink = (a: [number, number], b: [number, number], col: V3, wide = 0.012) => {
        const p = P(a[0], a[1], 0.028), q = P(b[0], b[1], 0.028), s = mul(unit(cross(sub(q, p), f)), wide / 2);
        hard.quad([sub(p, s), add(p, s), add(q, s), sub(q, s)], col);
      };
      const river: [number, number][] = [[-0.62, 0.22], [-0.42, 0.05], [-0.2, 0.1], [-0.02, -0.12], [0.2, -0.2]];
      for (let k = 0; k + 1 < river.length; k++) ink(river[k].map((v, i) => v * (i ? m.h : m.w * 0.72)) as [number, number], river[k + 1].map((v, i) => v * (i ? m.h : m.w * 0.72)) as [number, number], [0.2, 0.33, 0.5], 0.018);
      for (const [cx, cy] of [[-0.3, 0.16], [-0.08, -0.2], [0.02, 0.2]]) for (let k = 0; k < 8; k++) ink([cx * m.w + Math.cos(k * 0.785) * 0.06, cy * m.h + Math.sin(k * 0.785) * 0.06], [cx * m.w + Math.cos((k + 1) * 0.785) * 0.06, cy * m.h + Math.sin((k + 1) * 0.785) * 0.06], [0.6, 0.08, 0.06]);
    } else if (m.t === 'whip') {
      hard.box(add(m.at, [0, 0.05, 0]), [1, 0, 0], UP, [0, 0, 1], [0.04, 0.05, 0.04], PAINT.drab);
      hard.tube(add(m.at, [0, 0.1, 0]), add(m.at, [0.12, m.h, 0.05]), 0.012, 0.004, 3, PAINT.iron);
    }
    for (const k of skins) k.about = null;
  }
  return { hard, cloth, net, glow };
}

/** How many triangles the post is, made by hand: near (hard, cloth, nets, the glass of its lamps) and from far off. For whoever asks what it costs, with nothing drawn. */
export function postCounts(loose?: Loose[]): { hard: number; cloth: number; net: number; glow: number; near: number; far: number } {
  const k = postShape(postMade(loose), castleGround), far = new Skin(), mast = postMade(loose).find((m) => m.t === 'mast');
  if (mast && mast.t === 'mast') farMast(far, mast.at, mast.h);
  return { hard: k.hard.triangles, cloth: k.cloth.triangles, net: k.net.triangles, glow: k.glow.triangles, near: k.hard.triangles + k.cloth.triangles + k.net.triangles + k.glow.triangles, far: far.triangles };
}
