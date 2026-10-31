// The Zona's corridors laid along ground a body can walk (the owner, 2026-10-31: "some of the zona connections to move
// between zones and cities runs across veryhard to traverse terrian ... so the player isnt forced to walk up and down
// insane cliffs when moving about inthe zona"). They were straight lines between places, whatever lay between. Here the
// places are joined by the cheapest walk over the world's own ground, the shortest set that joins them all, and written
// to src/world/zona-ways.ts, which is all the game and the server read: the rule stays sums.
//
//   npx tsx scripts/zona-ways.ts            bakes src/world/zona-ways.ts and says what each way climbs
//   npx tsx scripts/zona-ways.ts picture    the Zona as baked over the old one, on the map: progress/zona-ways/before-after.png

import { createRequire } from 'node:module';
import fs from 'node:fs';
import { generateWorld, heightAt } from '../src/world/worldgen';
import { inside } from '../src/sim/water';
import { MIDDLE, ROUNDS, westAt, zonaDepth } from '../src/world/zona';

const require = createRequire(import.meta.url);
const OUT = 'src/world/zona-ways.ts';
const world = generateWorld() as unknown as ReturnType<typeof generateWorld> & { roads: { points: Float32Array }[]; water: { lakes: { outline: [number, number][]; swamp?: boolean }[]; rivers: { pts: [number, number, number, number][] }[] } };
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

/** the steepest ground a body climbs (src/game/player.ts CLIMB_MAX, 50 degrees), and what is hard going short of it (35) */
const WALL = Math.tan((50 * Math.PI) / 180), HARD = Math.tan((35 * Math.PI) / 180);

/** the old corridors, straight, 22 m either side: for the picture and to say what was wrong with them */
const OLD: [number, number, number, number][] = [
  [179, 174, 326, 98], [-279, 144, -368, 368], [326, -89, 537, -371], [326, 98, 625, 365], [-368, 368, -1180, 350],
  [-1180, 350, -1250, -120], [-1250, -120, -1450, -320], [-1450, -320, -1300, -480], [-1250, -120, -1507, 8],
  [-1507, 8, -1850, -30], [-1450, -320, -1560, -575], [-1560, -575, -1760, -505], [-1850, -30, -1855, 585],
];

/** what a line over the ground is like to walk: metres too steep to climb, metres of hard going, metres climbed */
function walk(pts: [number, number][]) {
  let wall = 0, hard = 0, climbed = 0, length = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(l / 4));
    for (let k = 0; k < n; k++) {
      const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n, x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
      const d = l / n, up = Math.abs(ground(x1, z1) - ground(x0, z0));
      length += d;
      climbed += up;
      if (up / d > WALL) wall += d;
      else if (up / d > HARD) hard += d;
    }
  }
  return { length: Math.round(length), wall: Math.round(wall), hard: Math.round(hard), climbed: Math.round(climbed) };
}

function picture() {
  const sharp = require('sharp');
  const X0 = -2100, X1 = 768, Z0 = -768, Z1 = 768, CELL = 2, w = (X1 - X0) / CELL + 1, h = (Z1 - Z0) / CELL + 1;
  const seg = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0;
    return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
  };
  const oldIn = (x: number, z: number) => {
    if (x < westAt(z)) return false;
    for (const [, cx, cz, r] of ROUNDS) if (Math.hypot(x - cx, z - cz) < r) return true;
    for (const [ax, az, bx, bz] of OLD) if (seg(x, z, ax, az, bx, bz) < 22) return true;
    let inMiddle = false;
    for (let i = 0, j = MIDDLE.length - 1; i < MIDDLE.length; j = i++) {
      const [xi, zi] = MIDDLE[i], [xj, zj] = MIDDLE[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inMiddle = !inMiddle;
    }
    return inMiddle;
  };
  const was = new Uint8Array(w * h), now = new Uint8Array(w * h);
  let oldN = 0, newN = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = X0 + i * CELL, z = Z0 + j * CELL, k = j * w + i;
    if ((was[k] = oldIn(x, z) ? 1 : 0)) oldN++;
    if ((now[k] = zonaDepth(x, z) > 0 ? 1 : 0)) newN++;
  }
  const edge = (a: Uint8Array, k: number) => a[k] === 1 && (a[k - 1] === 0 || a[k + 1] === 0 || a[k - w] === 0 || a[k + w] === 0);
  const px = Buffer.alloc(w * h * 3);
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
    const x = X0 + i * CELL, z = Z0 + j * CELL, k = j * w + i, y = ground(x, z);
    const gx = (ground(x + 2, z) - ground(x - 2, z)) / 4, gz = (ground(x, z + 2) - ground(x, z - 2)) / 4, g = Math.hypot(gx, gz);
    const lit = 62 + Math.max(-40, Math.min(70, (gx + gz) * -34)) + Math.min(50, y * 0.25);
    let c = [lit * 0.82, lit, lit * 0.74];
    if (g > WALL) c = [186, 62, 44];
    else if (g > HARD) c = [150, 118, 62];
    if (now[k]) c = [c[0] * 0.72 + 70, c[1] * 0.72 + 56, c[2] * 0.72 + 16];
    if (edge(was, k)) c = [255, 70, 70];
    if (edge(now, k)) c = [255, 226, 110];
    px[k * 3] = c[0]; px[k * 3 + 1] = c[1]; px[k * 3 + 2] = c[2];
  }
  fs.mkdirSync('progress/zona-ways', { recursive: true });
  void sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toFile('progress/zona-ways/before-after.png').then(() => console.log(`old ${Math.round(oldN * 4 / 1e4)} ha, new ${Math.round(newN * 4 / 1e4)} ha`));
}

function bake() {
  const STEP = 6, X0 = -2040, X1 = 768, Z0 = -768, Z1 = 768, nx = (X1 - X0) / STEP + 1, nz = (Z1 - Z0) / STEP + 1;
  const id = (i: number, j: number) => j * nx + i;
  const hh = new Float32Array(nx * nz), going = new Float32Array(nx * nz).fill(1);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = X0 + i * STEP, z = Z0 + j * STEP;
    hh[id(i, j)] = ground(x, z);
    if (x < westAt(z) + 12) going[id(i, j)] = 1e6;
  }
  // the going: what lies on the ground. (A road is the best way there is, over a river too: a bridge is a road.)
  const near = (x: number, z: number, r: number, f: (k: number) => void) => {
    const i0 = Math.round((x - r - X0) / STEP), i1 = Math.round((x + r - X0) / STEP), j0 = Math.round((z - r - Z0) / STEP), j1 = Math.round((z + r - Z0) / STEP);
    for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) f(id(i, j));
  };
  for (const l of world.water?.lakes ?? []) {
    const xs = l.outline.map((p) => p[0]), zs = l.outline.map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += STEP) for (let z = Math.min(...zs); z <= Math.max(...zs); z += STEP) if (inside(l.outline, x, z)) near(x, z, 0, (k) => (going[k] = Math.max(going[k], l.swamp ? 2 : 60)));
  }
  for (const r of world.water?.rivers ?? []) for (let n = 1; n < r.pts.length; n++) {
    const [ax, az, , wa] = r.pts[n - 1], [bx, bz] = r.pts[n], l = Math.hypot(bx - ax, bz - az);
    for (let t = 0; t <= l; t += STEP / 2) near(ax + ((bx - ax) * t) / l, az + ((bz - az) * t) / l, wa / 2 + 4, (k) => (going[k] = Math.max(going[k], 40)));
  }
  for (const r of world.roads) for (let n = 3; n < r.points.length; n += 3) {
    const ax = r.points[n - 3], az = r.points[n - 1], bx = r.points[n], bz = r.points[n + 2], l = Math.hypot(bx - ax, bz - az) || 1;
    for (let t = 0; t <= l; t += STEP / 2) near(ax + ((bx - ax) * t) / l, az + ((bz - az) * t) / l, 4, (k) => { if (going[k] < 1e5) going[k] = 0.55; });
  }
  // how steep the ground is round each point, whichever way one walks over it: a way along the foot of a cliff is no cliff
  const steep = new Float32Array(nx * nz);
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) steep[id(i, j)] = Math.hypot(hh[id(i + 1, j)] - hh[id(i - 1, j)], hh[id(i, j + 1)] - hh[id(i, j - 1)]) / (2 * STEP);

  const MOVES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  const step = (a: number, b: number, d: number) => {
    const up = Math.abs(hh[a] - hh[b]) / d, s = (steep[a] + steep[b]) / 2;
    const rough = 1 + (up / 0.3) ** 2 + (s / 0.55) ** 4 + (up > WALL ? 400 : 0);
    return d * ((going[a] + going[b]) / 2) * rough;
  };

  // the places, as sets of points: the middle of the valley and what stands in it are one
  const inMiddle = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = MIDDLE.length - 1; i < MIDDLE.length; j = i++) {
      const [xi, zi] = MIDDLE[i], [xj, zj] = MIDDLE[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const groups: { name: string; cells: Set<number> }[] = [{ name: 'the middle', cells: new Set() }];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (inMiddle(X0 + i * STEP, Z0 + j * STEP)) groups[0].cells.add(id(i, j));
  for (const [name, x, z, r] of ROUNDS) {
    const k = id(Math.round((x - X0) / STEP), Math.round((z - Z0) / STEP));
    const g = groups[0].cells.has(k) ? groups[0] : { name, cells: new Set<number>() };
    if (g !== groups[0]) groups.push(g);
    near(x, z, r * 0.8, (c) => {
      const cx = X0 + (c % nx) * STEP, cz = Z0 + Math.floor(c / nx) * STEP;
      if (Math.hypot(cx - x, cz - z) < r * 0.8 && going[c] < 1e5) g.cells.add(c);
    });
  }

  // the cheapest walk from one place to every point
  function spread(from: Set<number>) {
    const cost = new Float64Array(nx * nz).fill(Infinity), back = new Int32Array(nx * nz).fill(-1), done = new Uint8Array(nx * nz);
    const heap: [number, number][] = [];
    const push = (e: [number, number]) => {
      heap.push(e);
      for (let i = heap.length - 1; i > 0; ) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], end = heap.pop()!;
      if (heap.length) {
        heap[0] = end;
        for (let i = 0; ; ) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
      }
      return top;
    };
    for (const c of from) { cost[c] = 0; push([0, c]); }
    while (heap.length) {
      const [, a] = pop();
      if (done[a]) continue;
      done[a] = 1;
      const i = a % nx, j = Math.floor(a / nx);
      for (const [di, dj] of MOVES) {
        const u = i + di, v = j + dj;
        if (u < 0 || v < 0 || u >= nx || v >= nz) continue;
        const b = id(u, v);
        if (going[b] > 1e5) continue;
        const c = cost[a] + step(a, b, Math.hypot(di, dj) * STEP);
        if (c < cost[b]) { cost[b] = c; back[b] = a; push([c, b]); }
      }
    }
    return { cost, back };
  }

  // the shortest set that joins them all, by what the walk costs and not by how far apart they are
  const links: { a: number; b: number; cost: number; end: number; back: Int32Array }[] = [];
  groups.forEach((g, a) => {
    const { cost, back } = spread(g.cells);
    groups.forEach((o, b) => {
      if (b <= a) return;
      let best = Infinity, end = -1;
      for (const c of o.cells) if (cost[c] < best) { best = cost[c]; end = c; }
      links.push({ a, b, cost: best, end, back });
    });
  });
  // (and every pair the old corridors joined stays joined: a way somebody takes today is not taken from them)
  const groupAt = (x: number, z: number) => {
    const k = id(Math.round((x - X0) / STEP), Math.round((z - Z0) / STEP));
    let g = groups.findIndex((o) => o.cells.has(k));
    if (g < 0) g = groups.findIndex((o) => o.name === ROUNDS.find(([, cx, cz]) => cx === x && cz === z)?.[0]);
    return g;
  };
  const kept = new Set(OLD.map(([ax, az, bx, bz]) => [groupAt(ax, az), groupAt(bx, bz)].sort((p, q) => p - q).join('-')));
  const root = groups.map((_, i) => i), find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const ways: [number, number][][] = [];
  for (const l of links.sort((p, q) => p.cost - q.cost)) {
    const joins = find(l.a) !== find(l.b);
    if (!joins && !kept.has(`${l.a}-${l.b}`)) continue;
    if (joins) root[find(l.a)] = find(l.b);
    const cells: [number, number][] = [];
    for (let c = l.end; c >= 0; c = l.back[c]) cells.push([X0 + (c % nx) * STEP, Z0 + Math.floor(c / nx) * STEP]);
    if (cells.length < 2) continue;
    const way = chaikin(chaikin(simplify(cells, 5)));
    const said = walk(way);
    if (said.length < 30) continue;
    console.log(`${groups[l.a].name} - ${groups[l.b].name}: ${said.length} m, ${said.wall} m too steep, ${said.hard} m hard, ${said.climbed} m climbed`);
    ways.push(way);
  }
  console.log('\nthe old straight corridors:');
  for (const [ax, az, bx, bz] of OLD) {
    const s = walk([[ax, az], [bx, bz]]);
    console.log(`${ax},${az} to ${bx},${bz}: ${s.length} m, ${s.wall} m too steep, ${s.hard} m hard, ${s.climbed} m climbed`);
  }
  const lines = ways.map((w) => `  [${w.map(([x, z]) => `[${Math.round(x)}, ${Math.round(z)}]`).join(', ')}],`);
  fs.writeFileSync(OUT, `// The Zona's corridors, each a walkable line over the world's ground. Written by scripts/zona-ways.ts: run that, do not edit.\n\nexport const WAYS: [number, number][][] = [\n${lines.join('\n')}\n];\n`);
  console.log(`\n${ways.length} ways, ${ways.reduce((n, w) => n + w.length, 0)} points written to ${OUT}`);
}

/** a line with the points that make no difference left out (Douglas-Peucker) */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [ax, az] = pts[0], [bx, bz] = pts[pts.length - 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l;
    if (d > far) { far = d; at = i; }
  }
  if (far < tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

/** a line with its corners cut, so that it runs as a path runs */
function chaikin(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

if (process.argv[2] === 'picture') picture();
else bake();
