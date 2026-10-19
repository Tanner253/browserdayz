// The edge of the Zona as one line. The Zona is rounds laid over one another (PLAY_AREAS in the world's
// generator), and the maps drew its edge as what it is made of: a dashed arc for each round, meeting the next in
// a sharp notch ("i dont like the segmented circles"). Here the same edge is walked once, the whole way round,
// and each notch is rounded off, so that a map can draw it as a boundary is drawn.
//
// This is the picture of the rule and not the rule: `inPlay` says who is in the Zona, and nothing here is asked.
// So the line may not lie about it. Its points are on the true edge everywhere but in the notches; there it goes
// across the notch on the outside, never further from the true edge than three quarters of the fillet it was
// asked for. No point of it is inside the Zona: the ground between the line and the true edge is a sliver in each
// notch that the line calls in and the rule does not, and nowhere the other way about (but for the hair by which
// a straight piece between two points cuts under the curve: two centimetres on the smallest round of the Zona).
//
// Sums only: nothing of the page or of the renderer is known here (test/outline.test.ts holds it to all this).

import { PLAY_AREAS } from './worldgen';
import { zonaRings } from './zona';

export interface Round { x: number; z: number; r: number }
/** a closed line in world metres: its last point is its first again */
export type Ring = { x: number; z: number }[];

const TAU = Math.PI * 2;
/** how far a fillet may stand off the true edge, as a part of the radius asked for (the promise is 0.75) */
const OFF = 0.7;

/** a stretch of one round's edge that is inside no other round: from an angle to a greater one, as Math.atan2(z, x) gives them */
interface Arc { c: Round; from: number; to: number }
/**
 * A notch rounded off: the small round that touches both of the rounds meeting there, from outside. `cutA` and
 * `cutB` are the angles taken off the end of the stretch that comes into the notch and off the start of the one
 * that leaves it; the line goes round the fillet from the angle `from`, backward, through `sweep`.
 */
interface Fillet { x: number; z: number; r: number; cutA: number; cutB: number; from: number; sweep: number }

/** an angle brought into 0 .. a whole turn */
const turn = (a: number) => ((a % TAU) + TAU) % TAU;
const at = (c: Round, angle: number) => ({ x: c.x + Math.cos(angle) * c.r, z: c.z + Math.sin(angle) * c.r });

/**
 * The line round the played part of the map: one closed line round each separate piece of it (and one round any
 * hole in it), following the edge of the rounds laid together, with every notch where two of them meet replaced
 * by a fillet.
 *   fillet – the radius of that fillet, metres. It is made smaller where the notch is so sharp that it would stand
 *            too far off the true edge, or where the stretch it has to leave is too short for it (and where none
 *            will fit, which takes three rounds crossing all but at one place, the notch is left as it is).
 *            Nothing asked for, and the line is the true edge, notches and all.
 *   step   – the most the points of the line are apart, metres (closer on the fillets, so that they are round)
 * Each line ends on the point it began at.
 */
export function playRing(areas: Round[] = PLAY_AREAS, fillet = 14, step = 4): Ring[] {
  // (a step of nothing would be a line of points without end)
  step = Math.max(0.1, step);
  // a round wholly inside another has no edge of its own (of two the same, the first is kept)
  const within = (a: Round, b: Round) => Math.hypot(b.x - a.x, b.z - a.z) + a.r <= b.r;
  const rounds = areas
    .filter((a, i) => a.r > 0 && !areas.some((b, j) => j !== i && within(a, b) && (!within(b, a) || j < i)))
    .map((a) => ({ x: a.x, z: a.z, r: a.r }));
  const covered = (c: Round, angle: number) => {
    const p = at(c, angle);
    return rounds.some((b) => b !== c && Math.hypot(p.x - b.x, p.z - b.z) < b.r - 1e-9);
  };

  // ---- the true edge: of each round, the stretches that are inside no other
  const arcs: Arc[] = [], whole: Round[] = [];
  for (const a of rounds) {
    // where its edge goes into another round, or comes out of one
    let marks: number[] = [];
    for (const b of rounds) {
      if (b === a) continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d >= a.r + b.r || d <= Math.abs(a.r - b.r)) continue;
      const mid = Math.atan2(b.z - a.z, b.x - a.x), half = Math.acos((a.r * a.r + d * d - b.r * b.r) / (2 * a.r * d));
      marks.push(turn(mid - half), turn(mid + half));
    }
    marks.sort((p, q) => p - q);
    marks = marks.filter((m, k) => k === 0 || m - marks[k - 1] > 1e-9);
    // between one mark and the next it is all inside another round or all outside every one: its middle says which
    const n = marks.length;
    const free = marks.map((m, k) => !covered(a, (m + (k + 1 < n ? marks[k + 1] : marks[0] + TAU)) / 2));
    if (free.every(Boolean)) {
      whole.push(a);
      continue;
    }
    for (let k = 0; k < n; k++) {
      if (!free[k] || free[(k + n - 1) % n]) continue;
      let last = k;
      while (free[(last + 1) % n]) last++;
      let to = marks[(last + 1) % n];
      while (to <= marks[k]) to += TAU;
      arcs.push({ c: a, from: marks[k], to });
    }
  }

  // ---- walked: each stretch ends in a notch, where the stretch of the next round begins (going the way the
  // angles grow, every one of them has the Zona on the same hand, so they follow on from one another)
  const starts = arcs.map((a) => at(a.c, a.from)), ends = arcs.map((a) => at(a.c, a.to));
  const next = ends.map((e) => {
    let best = 0, near = Infinity;
    starts.forEach((s, j) => {
      const d = Math.hypot(s.x - e.x, s.z - e.z);
      if (d < near) [near, best] = [d, j];
    });
    return best;
  });
  const prev: number[] = [];
  next.forEach((j, i) => (prev[j] = i));

  // ---- the fillet in the notch at the end of a stretch
  const make = (i: number, f: number): Fillet | null => {
    const a = arcs[i].c, b = arcs[next[i]].c, p = ends[i];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (a === b || d < 1e-9) return null;
    const ux = (b.x - a.x) / d, uz = (b.z - a.z) / d;
    // (which side of the line between the two middles the notch is on)
    const side = (p.z - a.z) * ux - (p.x - a.x) * uz < 0 ? -1 : 1;
    for (let tries = 0; tries < 8 && f > 0.05; tries++) {
      // its middle: f outside the one round and f outside the other
      const ra = a.r + f, rb = b.r + f;
      const along = (d * d + ra * ra - rb * rb) / (2 * d), up = Math.sqrt(Math.max(0, ra * ra - along * along)) * side;
      const x = a.x + ux * along - uz * up, z = a.z + uz * along + ux * up;
      const toA = Math.atan2(z - a.z, x - a.x), toB = Math.atan2(z - b.z, x - b.x);
      const cutA = turn(arcs[i].to - toA), cutB = turn(toB - arcs[next[i]].from);
      const from = toA + Math.PI, sweep = turn(toA - toB);
      if (!(cutA > 0 && cutA < Math.PI && cutB > 0 && cutB < Math.PI && sweep > 0 && sweep < Math.PI)) return null;
      // how far off the two rounds it stands, where it stands furthest
      let off = 0;
      for (let k = 1; k < 16; k++) {
        const t = from - (sweep * k) / 16, qx = x + Math.cos(t) * f, qz = z + Math.sin(t) * f;
        off = Math.max(off, Math.min(Math.hypot(qx - a.x, qz - a.z) - a.r, Math.hypot(qx - b.x, qz - b.z) - b.r));
      }
      if (off <= fillet * OFF) return { x, z, r: f, cutA, cutB, from, sweep };
      // (a sharp notch: a smaller fillet sits deeper in it, and nearer the edge in proportion)
      f *= (fillet * OFF * 0.97) / off;
    }
    return null;
  };
  // every notch is given the fillet asked for; where a stretch is too short for the two at its ends, both are made smaller
  const radius = arcs.map(() => fillet);
  let made: (Fillet | null)[] = [];
  const fit = () => {
    made = arcs.map((_, i) => make(i, radius[i]));
    // (the radius each was in fact given: a sharp notch has had a smaller one already)
    made.forEach((m, i) => m && (radius[i] = m.r));
  };
  /** how much of a stretch the fillets at its two ends take up */
  const taken = (j: number) => {
    const before = prev[j] === undefined ? null : made[prev[j]];
    return ((before?.cutB ?? 0) + (made[j]?.cutA ?? 0)) / (arcs[j].to - arcs[j].from);
  };
  fit();
  for (let pass = 0; pass < 12; pass++) {
    let tight = false;
    arcs.forEach((_, j) => {
      const part = taken(j);
      if (part <= 0.9) return;
      tight = true;
      radius[j] *= 0.8 / part;
      if (prev[j] !== undefined) radius[prev[j]] *= 0.8 / part;
    });
    if (!tight) break;
    fit();
  }
  // (and if that did not do it, the notch is left as it is)
  arcs.forEach((_, j) => {
    if (taken(j) <= 0.9) return;
    made[j] = null;
    if (prev[j] !== undefined) made[prev[j]] = null;
  });

  // ---- drawn out as points
  const rings: Ring[] = [];
  const done = arcs.map(() => false);
  for (let first = 0; first < arcs.length; first++) {
    if (done[first]) continue;
    const ring: Ring = [];
    const put = (x: number, z: number) => {
      const q = ring[ring.length - 1];
      if (!q || Math.hypot(q.x - x, q.z - z) > 1e-6) ring.push({ x, z });
    };
    for (let i = first; !done[i]; i = next[i]) {
      done[i] = true;
      const arc = arcs[i], before = prev[i] === undefined ? null : made[prev[i]], after = made[i];
      const from = arc.from + (before?.cutB ?? 0), to = arc.to - (after?.cutA ?? 0);
      const n = Math.max(1, Math.ceil(((to - from) * arc.c.r) / step));
      for (let k = 0; k <= n; k++) {
        const p = at(arc.c, from + ((to - from) * k) / n);
        put(p.x, p.z);
      }
      if (!after) continue;
      // (its two ends are the end of this stretch and the start of the next: only what is between them is put down)
      const m = Math.max(2, Math.ceil(after.sweep * Math.max(after.r / step, 4)));
      for (let k = 1; k < m; k++) {
        const t = after.from - (after.sweep * k) / m;
        put(after.x + Math.cos(t) * after.r, after.z + Math.sin(t) * after.r);
      }
    }
    const q = ring[ring.length - 1];
    if (ring.length > 1 && Math.hypot(q.x - ring[0].x, q.z - ring[0].z) <= 1e-6) ring.pop();
    if (ring.length < 3) continue;
    ring.push({ ...ring[0] });
    rings.push(ring);
  }
  // a round that touches no other is a line of its own
  for (const c of whole) {
    const n = Math.max(8, Math.ceil((TAU * c.r) / step));
    const ring: Ring = [];
    for (let k = 0; k < n; k++) ring.push(at(c, (TAU * k) / n));
    ring.push({ ...ring[0] });
    rings.push(ring);
  }
  return rings;
}

let kept: Ring[] | null = null;
/** The line round the Zona as it is: worked out once and kept, for it never changes. The Zona as the owner drew it (src/world/zona.ts) since 2026-10-18; playRing draws the rounds it was. */
export function playEdge(): Ring[] {
  return (kept ??= zonaRings());
}
