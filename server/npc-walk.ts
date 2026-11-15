// Where one of the server's survivors can stand and walk, by the map's own walls and floors (2026-11-15). The owner:
// "should hide in buildings etc it should behave like a real player". The animals' ground (src/sim/animal-ground.ts)
// has every building as one solid box, which kept them out of doors; the walls the server reads for rounds
// (server/walls.ts) are the game's own solids, floors and doorways among them, so a body is walked through those:
// a floor found under it, head room over it, and nothing across its knees or its chest on the way.

import type { Ground } from '../src/sim/animal-ground';
import { safe } from './camp';
import { solid } from './solid';
import { roundHit } from './walls';

export interface Spot { x: number; y: number; z: number }

let ground: Ground;
export const walkOn = (g: Ground) => void (ground = g);

/** how much it steps up and drops in one step, how tall it is, and a side of the squares a way is found over, metres */
const RISE = 0.45, DROP = 1.2, TALL = 1.75, CELL = 0.75;

/** under a roof: in one of the map's buildings */
export const indoors = (x: number, z: number) => ground.roofed(x, z);

/**
 * The height a body whose feet are at about `y` would stand at there: the ground, or a floor of the map's over it.
 * Null where it cannot: water, the traders' camp, a trunk or a rock, inside a wall, no head room.
 */
export function standAt(x: number, z: number, y: number): number | null {
  if (safe(x, z) || !(ground.open(x, z, 0.9) || ground.roofed(x, z))) return null;
  const g = ground.height(x, z);
  let f = g;
  const hit = roundHit([x, y + 1.1, z], [x, y - DROP - 0.1, z]);
  if (hit !== null) {
    // (begun inside something solid: a wall, a pillar)
    if (hit < 0.02) return null;
    if (y + 1.1 - hit > g - 0.05) f = y + 1.1 - hit;
  }
  if (roundHit([x, f + 0.4, z], [x, f + TALL, z]) !== null) return null;
  return f;
}

/** One step from where it stands to a place beside it: where it then stands, or null if something is in the way. */
export function stepTo(a: Spot, x: number, z: number): Spot | null {
  const y = standAt(x, z, a.y);
  if (y === null || y - a.y > RISE || a.y - y > DROP) return null;
  for (const h of [0.55, 1.35]) {
    const from: [number, number, number] = [a.x, a.y + h, a.z], to: [number, number, number] = [x, y + h, z];
    if (roundHit(from, to) !== null || !solid.clear(from, to)) return null;
  }
  return { x, y, z };
}

/** whether a body has a hand's room about it there: a way found keeps off the walls */
function roomy(s: Spot) {
  for (const [dx, dz] of [[0.38, 0], [-0.38, 0], [0, 0.38], [0, -0.38]]) if (roundHit([s.x, s.y + 1, s.z], [s.x + dx, s.y + 1, s.z + dz]) !== null) return false;
  return true;
}

/** whether it can walk straight from one place to another */
export function straight(a: Spot, b: { x: number; z: number }): Spot | null {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / CELL));
  let at: Spot | null = a;
  for (let k = 1; k <= n && at; k++) at = stepTo(at, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n);
  return at;
}

/** how many squares were looked at by the last ways found, and how long they took (NPC_LOG says it) */
export const ROUTES = { n: 0, cells: 0, ms: 0, none: 0 };

/**
 * A way on foot from `from` to within a step of `to`, round walls and through doorways: the places to walk to, in
 * order, the last of them the end. Null if none is found within `cap` squares (too far, or shut in).
 */
export function route(from: Spot, to: { x: number; z: number }, cap = 450): Spot[] | null {
  const t0 = performance.now();
  interface Node { i: number; j: number; s: Spot; g: number; f: number; back: Node | null; shut: boolean }
  const key = (i: number, j: number) => i * 4096 + j;
  const nodes = new Map<number, Node | null>();
  const h = (s: Spot) => Math.hypot(to.x - s.x, to.z - s.z) * 1.4;
  const start: Node = { i: 0, j: 0, s: from, g: 0, f: h(from), back: null, shut: false };
  nodes.set(key(0, 0), start);
  const open: Node[] = [start];
  let end: Node | null = null, looked = 0;
  while (open.length && looked < cap) {
    let b = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[b].f) b = k;
    const cur = open[b];
    open[b] = open[open.length - 1];
    open.pop();
    if (cur.shut) continue;
    cur.shut = true;
    looked++;
    if (Math.hypot(to.x - cur.s.x, to.z - cur.s.z) < CELL) {
      end = cur;
      break;
    }
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const i = cur.i + di, j = cur.j + dj, k = key(i, j), was = nodes.get(k);
      if (was === null || was?.shut) continue;
      const s = stepTo(cur.s, from.x + i * CELL, from.z + j * CELL);
      if (!s) {
        // (no standing there at all, as against no way to it from this side)
        if (!was && standAt(from.x + i * CELL, from.z + j * CELL, cur.s.y) === null) nodes.set(k, null);
        continue;
      }
      // (hard against a wall: only where it is going may be)
      if (!was && Math.hypot(to.x - s.x, to.z - s.z) > 1.3 && !roomy(s)) {
        nodes.set(k, null);
        continue;
      }
      const g = cur.g + (di && dj ? 1.414 : 1) * CELL;
      if (was && was.g <= g) continue;
      const n: Node = { i, j, s, g, f: g + h(s), back: cur, shut: false };
      if (was) was.shut = true;
      nodes.set(k, n);
      open.push(n);
    }
  }
  ROUTES.n++;
  ROUTES.cells += looked;
  ROUTES.ms += performance.now() - t0;
  if (!end) {
    ROUTES.none++;
    return null;
  }
  const way: Spot[] = [];
  for (let n: Node | null = end; n?.back; n = n.back) way.push(n.s);
  way.reverse();
  // (the corners only: each place it can walk straight to from the one before is left out)
  const out: Spot[] = [];
  let at = from;
  for (let k = 0; k < way.length; ) {
    let far = k;
    for (let q = Math.min(way.length - 1, k + 10); q > k; q--) {
      if (straight(at, way[q])) {
        far = q;
        break;
      }
    }
    out.push(way[far]);
    at = way[far];
    k = far + 1;
  }
  return out;
}
