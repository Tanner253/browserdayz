// The fort's shape: its towers, their floors, doors, slits and stairs.
// (One part of castle-shape.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { KIT_TOWER } from '../../sim/kit';
import { type Tower, CASTLE, type V3, towerRadius } from '../../sim/castle';
import { TILE, UP, add, apart, cross, dot, hash, mul, norm360, rad, sorted, sub, unit, weather, type Out, type UV } from './base';
import { RAIL, SLOPE_HALF, boxSolid, headAt, holedFace, railRun, sillAt, squareHead, squareSill, timber, type Put } from './parts';

/** the boards a tower's floor is laid with stand this far over the paving (they lie on it, and are heard underfoot) */
export const TOWER_FLOOR = 0.06;

/**
 * A tower is the biggest single piece of the fort to make (a fortieth of a second each): so it is made in sections,
 * stopping between them, for whoever makes the fort a piece at a time (see `castleShapeSteps`).
 */
export function towerPart(tw: Tower, stone: Out, wood: Out, dark: Out, put: Put, lod: number) {
  const sections = towerSteps(tw, stone, wood, dark, put, lod);
  while (!sections.next().done);
}

/** set while a shape is being made a piece at a time: a tower is then not made where it is asked for, but handed over here in its sections */
export const towerLater: { on: boolean; sections: Generator<undefined, void, void> | null } = { on: false, sections: null };

export function* towerSteps(tw: Tower, stone: Out, wood: Out, dark: Out, put: Put, lod: number): Generator<undefined, void, void> {
  const T = CASTLE.tower, n = lod ? 20 : 48, rin = T.r - T.wall, tone = tw.tone ?? 1, tile = TILE.stone, seed = Math.round(tw.cx * 7 + tw.cz * 13);
  /** it is hollow under its boards, down to here (see `hollow`): a doorway is left in its foot, under its door, so high */
  const hollow = tw.hollow, DOOR = 2.2, doorHalf = (r: number) => (Math.asin(0.55 / r) * 180) / Math.PI;
  const P = (a: number, r: number, y: number): V3 => [tw.cx + Math.cos(rad(a)) * r, y, tw.cz + Math.sin(rad(a)) * r];
  const out = (a: number): V3 => [Math.cos(rad(a)), 0, Math.sin(rad(a))], round = (a: number): V3 => [-Math.sin(rad(a)), 0, Math.cos(rad(a))];
  const levels = (from: number, to: number, step: number) => {
    const k = Math.max(1, Math.ceil((from - to) / step));
    return Array.from({ length: k + 1 }, (_, i) => from + ((to - from) * i) / k);
  };

  // ---- under the terrace: a cone in bands, each with as many turns of the picture as fit its girth, and the
  // builders' holes in it as far down as the hill lets them be seen
  // (the kit's tower stands for all of it down to the foot of its footing: see `castleKit`)
  const kitFoot = -KIT_TOWER.top[0] * (T.kit + T.under), seen = -9.4, ys = sorted([...levels(0, T.bend, lod ? 99 : 2.5), ...levels(T.bend, tw.foot, lod ? 99 : 3.3).slice(1), ...(lod ? [] : [seen, kitFoot + 0.05]), ...(hollow !== undefined && !lod ? [hollow, hollow + DOOR] : [])], 0.05).reverse();
  const leanAt = (y: number) => (y > T.bend ? 1 / T.lean : 1 / T.flare), cols = (k: number) => Array.from({ length: k + 1 }, (_, j) => (j * 360) / k);
  const pits: [number, number][] = [];
  if (!lod) for (let y = -1.3, r = 0; y > seen + 0.3; y -= 1.75, r++) for (let a = (r % 2) * 22.5; a < 359; a += 45) if (hollow === undefined || apart(a, tw.door) > 12 || y > hollow + DOOR + 0.3) pits.push([a, y]);
  // (from near the foot of a tower is the kit's round tower: see `castleKit`. This is what stands for it from far off.)
  let s0 = 0;
  // (and, from near, what is under the kit tower's own foot: the hill is lower than that on three sides)
  for (let i = 0; i + 1 < ys.length; i++) {
    // (nor from far off: the kit's own far copy is there, and a plain round in the very place of it was seen through it, paler. What stands for the kit until its far copy has come is made with the blocks: see `castleShapeSteps`.)
    if (lod || ys[i] > kitFoot + 0.06) continue;
    const y0 = ys[i], y1 = ys[i + 1], r0 = towerRadius(y0), r1 = towerRadius(y1), s1 = s0 - Math.hypot(y0 - y1, r1 - r0), turns = Math.max(1, Math.round((Math.PI * (r0 + r1)) / TILE.base)), from = s0;
    // (the doorway in a hollow foot is left out of the band it is in)
    const door = hollow !== undefined && !lod && y1 >= hollow - 0.01 && y0 <= hollow + DOOR + 0.01, us = lod ? cols(n) : y0 <= seen + 0.01 ? cols(24) : cols(48);
    const band = (a0: number, a1: number) => holedFace(dark, {
      at: (a, y) => P(a, towerRadius(y), y),
      n: (a, y) => unit([Math.cos(rad(a)), leanAt(y), Math.sin(rad(a))]),
      uv: (a, y) => [(a / 360) * turns * TILE.base, from - ((y0 - y) / (y0 - y1)) * (from - s1)],
      tone: (y) => weather(y) * tone,
      round: true,
    }, us.filter((a) => a >= a0 - 1e-6 && a <= a1 + 1e-6), [y1, y0], pits.filter(([a, y]) => y < y0 && y > y1 && a > a0 && a < a1), 0.9);
    if (door) {
      const dh = doorHalf((r0 + r1) / 2), lo = Math.floor((norm360(tw.door) - dh) / 7.5) * 7.5, hi = Math.ceil((norm360(tw.door) + dh) / 7.5) * 7.5;
      band(0, lo);
      band(hi, 360);
    } else band(0, 360);
    s0 = s1;
  }
  if (hollow !== undefined && !lod) {
    // the round cellar in its foot: its wall, its floor, and the doorway through to the lower levels
    // NOTHING OF IT IS OPEN BUT ITS DOORWAY AND THE HOLE IN THE BOARDS. (2026-10-14, played: "in the circular part of
    // the building with the hold in the middle that allows you to drop below, from below you can see gaps in the
    // walls". Three things, each seen from its floor. Its wall stopped a hand under the boards, and all round its top
    // was a band through which the tower's foot was looked into, which is the kit's and a skin with nothing in it:
    // pale stone from behind, and the sky. Its wall is in lengths of fifteen degrees and its doorway is as wide as its
    // lining, which is not fifteen degrees: a slit was left either side of the doorway. And the lining ended at one
    // distance from top to bottom while the tower's face leans: at the floor it stopped short of the face.)
    // So: its wall goes up to the underside of the boards; it is cut at the doorway's own two sides; and the lining
    // of the doorway goes out to a finger past the tower's face at every height.
    const top = TOWER_FLOOR - 0.06, dh = doorHalf(rin), far = (y: number) => towerRadius(y) + 0.03, ro = far(hollow), rt = far(hollow + DOOR);
    const round0 = sorted([...cols(48), norm360(tw.door - dh), norm360(tw.door + dh)], 0.01);
    for (let j = 0; j + 1 < round0.length; j++) {
      const a0 = round0[j], a1 = round0[j + 1], inDoor = apart((a0 + a1) / 2, tw.door) < dh, lo = inDoor ? hollow + DOOR : hollow;
      dark.quad([P(a0, rin, lo), P(a1, rin, lo), P(a1, rin, top), P(a0, rin, top)], [[rad(a0) * rin, lo], [rad(a1) * rin, lo], [rad(a1) * rin, top], [rad(a0) * rin, top]], mul(out((a0 + a1) / 2), -1), tone * 0.8, [a0, a1, a1, a0].map((a) => mul(out(a), -1)));
      // (a finger over the galleries' own floor, which runs in under it)
      const pts = [P(0, 0, hollow + 0.02), P(a1, rin, hollow + 0.02), P(a0, rin, hollow + 0.02)];
      dark.tri(pts, pts.map((p): UV => [p[0], p[2]]), UP, tone * 0.8);
    }
    // (each side of the lining and its head are drawn from behind as well: the tower's face is the kit's, flat by
    // lengths and a hand inside the round it is reckoned as, so the lining stands a little proud of it, as a frame does,
    // and what stands proud is seen from outside)
    // (its back is a finger behind its face: the edge the kit's foot is cut to, 0.553 from the middle, is inside that finger)
    const turned = (w: number, r: number) => (Math.asin(w / r) * 180) / Math.PI;
    for (const side of [-1, 1]) for (const [w, face] of [[0.55, -side], [0.556, side]]) dark.quad([P(tw.door + side * turned(w, rin), rin, hollow), P(tw.door + side * turned(w, ro), ro, hollow), P(tw.door + side * turned(w, rt), rt, hollow + DOOR), P(tw.door + side * turned(w, rin), rin, hollow + DOOR)], [[0, hollow], [ro - rin, hollow], [rt - rin, hollow + DOOR], [0, hollow + DOOR]], mul(round(tw.door), face), tone * 0.75);
    for (const [up, face] of [[0, -1], [0.006, 1]]) dark.quad([P(tw.door - dh, rin, hollow + DOOR + up), P(tw.door + dh, rin, hollow + DOOR + up), P(tw.door + doorHalf(rt), rt, hollow + DOOR + up), P(tw.door - doorHalf(rt), rt, hollow + DOOR + up)], [[0, 0], [1.1, 0], [1.1, rt - rin], [0, rt - rin]], [0, face, 0], tone * 0.7);
    const sill = [P(tw.door - dh, rin, hollow), P(tw.door + dh, rin, hollow), P(tw.door + doorHalf(ro), ro, hollow), P(tw.door - doorHalf(ro), ro, hollow)];
    dark.quad(sill, sill.map((p): UV => [p[0], p[2]]), UP, tone * 0.8);
  }

  yield;
  // ---- over it: a drum, open to the sky, with a door to the terrace and windows; its top is what is left of a battlement
  type Hole = { a: number; w: number; y0: number; y1: number; arch: boolean; round?: boolean };
  const holes: Hole[] = lod ? [] : [{ a: tw.door, w: TOWER_DOOR.w, y0: 0, y1: TOWER_DOOR.h, arch: true }, ...tw.slits.map((s) => ({ a: s.a, w: SLIT_WIDE, y0: s.y0, y1: s.y1, arch: true })), ...(tw.lost ?? []).map((s) => ({ a: s.a, w: LOST_WIDE, y0: s.y0, y1: s.y1, arch: true, round: true }))];
  /** how far either side of its middle an opening reaches, at so far from the tower's own: its sides are square to the wall, not drawn to the tower's middle */
  const halfAt = (h: Hole, r: number) => (Math.asin(h.w / 2 / r) * 180) / Math.PI;
  const rimAt = (a: number) => {
    const k = Math.floor(norm360(a) / (360 / T.slots)) % T.slots;
    // (no two stones of a broken top are at one height: each half of a stub is a little under what the plan says)
    return tw.rim[k] - (!lod && k % 2 === 0 ? 0.24 * hash(Math.floor(norm360(a) / 7.5), seed, 5) : 0);
  };
  const columns = (r: number) => {
    const cuts = new Set<number>();
    for (let j = 0; j < n; j++) cuts.add((j * 360) / n);
    for (const h of holes) for (let k = 0; k <= 6; k++) cuts.add(norm360(h.a - halfAt(h, r) + (2 * halfAt(h, r) * k) / 6));
    const as = sorted(cuts, 0.05);
    return as.map((a0, i) => ({ a0, a1: i + 1 < as.length ? as[i + 1] : as[0] + 360 }));
  };
  for (const [r, s] of [[T.r, 1], [rin, -1]] as [number, number][]) {
    const turns = Math.max(1, Math.round((2 * Math.PI * r) / tile)), u = (a: number) => (a / 360) * turns * tile;
    for (const { a0, a1 } of columns(r)) {
      const mid = (a0 + a1) / 2, top = rimAt(mid), h = holes.find((q) => apart(mid, q.a) < halfAt(q, r));
      // (what stands in this length of it: under an opening as far as its foot or the wall's top, whichever is lower, and over it if the wall goes so high)
      const spans: [number, number, number, number][] = [];
      if (!h) spans.push([0, 0, top, top]);
      else {
        const t = (a: number) => (norm360(a - h.a + 180) - 180) / halfAt(h, r), head = (a: number) => headAt(h.y0, h.y1, h.w / 2, h.arch, t(a)), foot = (a: number) => Math.min(top, sillAt(h.y0, h.y1, h.w / 2, h.round, t(a)));
        if (Math.max(foot(a0), foot(a1)) > 0.01) spans.push([0, 0, foot(a0), foot(a1)]);
        if (top > Math.max(head(a0), head(a1)) + 0.02) spans.push([head(a0), head(a1), top, top]);
      }
      for (const [b0, b1, t0, t1] of spans) stone.quad([P(a0, r, b0), P(a1, r, b1), P(a1, r, t1), P(a0, r, t0)], [[u(a0), b0], [u(a1), b1], [u(a1), t1], [u(a0), t0]], mul(out(mid), s), tone * (s > 0 ? 1 : 0.86), [a0, a1, a1, a0].map((a) => mul(out(a), s)));
    }
    yield;
  }
  // the top of the wall, and the faces of its stubs
  for (let j = 0; j < n; j++) {
    const a0 = (j * 360) / n, a1 = ((j + 1) * 360) / n, top = rimAt((a0 + a1) / 2), next = rimAt(a1 + 180 / n);
    const pts = [P(a0, rin, top), P(a1, rin, top), P(a1, T.r, top), P(a0, T.r, top)];
    stone.quad(pts, pts.map((p): UV => [p[0], p[2]]), UP, tone * 0.94);
    if (Math.abs(next - top) > 0.01) stone.quad([P(a1, rin, Math.min(top, next)), P(a1, T.r, Math.min(top, next)), P(a1, T.r, Math.max(top, next)), P(a1, rin, Math.max(top, next))], [[rin, Math.min(top, next)], [T.r, Math.min(top, next)], [T.r, Math.max(top, next)], [rin, Math.max(top, next)]], mul(round(a1), next < top ? 1 : -1), tone * 0.9);
  }
  if (!lod) for (const h of holes) {
    // the sides of each opening, its sill and its head, through the thickness of the wall
    const ho = halfAt(h, T.r), hi = halfAt(h, rin), rise = h.y1 - headAt(h.y0, h.y1, h.w / 2, h.arch, 1), foot = h.round ? h.y0 + rise : h.y0;
    // (nothing of it is left to line where the wall itself has come down past it)
    if (rimAt(h.a) < h.y1 + 0.05) continue;
    for (const side of [-1, 1]) stone.quad([P(h.a + side * ho, T.r, foot), P(h.a + side * hi, rin, foot), P(h.a + side * hi, rin, h.y1 - rise), P(h.a + side * ho, T.r, h.y1 - rise)], [[0, foot], [T.wall, foot], [T.wall, h.y1 - rise], [0, h.y1 - rise]], mul(round(h.a), -side), tone * 0.84);
    if (h.round) for (let k = 0; k < 6; k++) {
      const t0 = -1 + k / 3, t1 = -1 + (k + 1) / 3, h0 = sillAt(h.y0, h.y1, h.w / 2, true, t0), h1 = sillAt(h.y0, h.y1, h.w / 2, true, t1);
      stone.quad([P(h.a + t0 * ho, T.r, h0), P(h.a + t1 * ho, T.r, h1), P(h.a + t1 * hi, rin, h1), P(h.a + t0 * hi, rin, h0)], [[t0 * 0.3, 0], [t1 * 0.3, 0], [t1 * 0.3, T.wall], [t0 * 0.3, T.wall]], UP, tone * 0.8);
    }
    for (let k = 0; k < 6; k++) {
      const t0 = -1 + k / 3, t1 = -1 + (k + 1) / 3, h0 = headAt(h.y0, h.y1, h.w / 2, h.arch, t0), h1 = headAt(h.y0, h.y1, h.w / 2, h.arch, t1);
      stone.quad([P(h.a + t0 * ho, T.r, h0), P(h.a + t1 * ho, T.r, h1), P(h.a + t1 * hi, rin, h1), P(h.a + t0 * hi, rin, h0)], [[t0 * 0.4, 0], [t1 * 0.4, 0], [t1 * 0.4, T.wall], [t0 * 0.4, T.wall]], [0, -1, 0], tone * 0.78);
    }
    if (h.y0 > 0.01 && !h.round) stone.quad([P(h.a - ho, T.r, h.y0), P(h.a + ho, T.r, h.y0), P(h.a + hi, rin, h.y0), P(h.a - hi, rin, h.y0)], [[-0.4, 0], [0.4, 0], [0.4, T.wall], [-0.4, T.wall]], UP, tone * 0.9);
  }
  if (lod) return;

  yield;
  // ---- what stops a body. Under the terrace, the cone itself (it bulges nowhere, so a shape drawn tight round
  // three rings of it is the cone); over it, the wall in lengths, left out where its openings are.
  // (A hollow foot is its wall in short lengths down to its cellar's floor, left out at the doorway, and the cone under that.)
  const hull: number[] = [];
  for (const y of [hollow ?? 0, T.bend, -KIT_TOWER.top[0] * T.kit, tw.foot]) for (let k = 0; k < 16; k++) hull.push(...P(k * 22.5, towerRadius(Math.min(y, -0.001)) / Math.cos(rad(11.25)), y));
  // (and the low ring of the kit's parapet that stands round the foot of the drum, outside the walls)
  if (!lod) for (let k = 0; k < 16; k++) {
    const a = (k + 0.5) * 22.5, c = P(a, (T.r + KIT_TOWER.ring.r1 * T.kit) / 2, 0.36);
    if (Math.abs(c[0]) > CASTLE.hx + CASTLE.parapet.thick / 2 - 1.5 || Math.abs(c[2]) > CASTLE.hz + CASTLE.parapet.thick / 2 - 1.5) put(boxSolid(c, [out(a), UP, cross(out(a), UP)], [(KIT_TOWER.ring.r1 * T.kit - T.r) / 2, 0.36, 0.75], false, 'concrete', tw.name ?? 'tower'));
  }
  put({ t: 'hull', pts: hull, feet: false, surface: 'concrete', name: tw.name ?? 'tower' });
  if (hollow !== undefined) {
    for (let k = 0; k < 32; k++) {
      const a0 = k * 11.25, a1 = a0 + 11.25, inDoor = apart(a0 + 5.625, tw.door) < 11.25, lo = inDoor ? hollow + DOOR : hollow, pts: number[] = [];
      for (const a of [a0, a1]) for (const y of [lo, 0]) for (const r of [rin, towerRadius(y) / Math.cos(rad(5.625))]) pts.push(...P(a, r, y));
      put({ t: 'hull', pts, feet: false, surface: 'concrete', name: tw.name ?? 'tower' });
    }
  }
  const rm = (T.r + rin) / 2, hard = new Set<number>();
  for (let k = 0; k < T.slots; k++) hard.add((k * 360) / T.slots);
  for (const h of holes) hard.add(norm360(h.a - halfAt(h, rm))).add(norm360(h.a + halfAt(h, rm)));
  const hs = sorted(hard, 0.5);
  hs.forEach((a0, i) => {
    const a1 = i + 1 < hs.length ? hs[i + 1] : hs[0] + 360, mid = (a0 + a1) / 2, h = holes.find((q) => apart(mid, q.a) < halfAt(q, rm));
    const top = tw.rim[Math.floor(norm360(mid) / (360 / T.slots)) % T.slots];
    for (const [lo, hi] of h ? [[0, Math.min(top, squareSill(h, h.w / 2))], [squareHead(h, h.w / 2), top]] : [[0, top]]) {
      if (hi - lo > 0.05) put(boxSolid(P(mid, rm, (lo + hi) / 2), [out(mid), UP, cross(out(mid), UP)], [T.wall / 2, (hi - lo) / 2, T.r * Math.tan(rad((a1 - a0) / 2)) + 0.01], false, 'concrete', tw.name ?? 'tower'));
    }
  });

  yield;
  // ---- its floor: boards laid on the paving, with a riser where the door comes in
  const ring = (y: number, r0: number, r1: number, a0: number, a1: number, face: V3, k = 1) => {
    const pts = r0 > 0 ? [P(a0, r0, y), P(a1, r0, y), P(a1, r1, y), P(a0, r1, y)] : [P(0, 0, y), P(a1, r1, y), P(a0, r1, y)];
    // (boards across the way that is walked: the picture's own boards run up it)
    const uv = pts.map((p): UV => [p[0], p[2]]);
    if (r0 > 0) wood.quad(pts, uv, face, tone * k);
    else wood.tri(pts, uv, face, tone * k);
  };
  const disc = (name: string, y0: number, y1: number, r: number) => {
    const pts: number[] = [];
    for (const y of [y0, y1]) for (let k = 0; k < 16; k++) pts.push(...P(k * 22.5, r / Math.cos(rad(11.25)), y));
    put({ t: 'hull', pts, feet: false, surface: 'wood', name });
  };
  // (a hollow tower's boards have rotted through in the middle: a hole a body goes down)
  const hole = hollow !== undefined ? 1.05 : 0;
  // THE BOARDS GO TO THE WALL, AND UNDER IT. (The wall is round by forty-eight lengths and bellies a hand either way, as
  // old stone does; the boards were round by twenty-four and do not belly: between their edge and the wall were slits a
  // finger to a hand wide, and through them the tower's foot was looked into, which is a skin with nothing in it. So
  // they are laid in the wall's own lengths, and run on a hand under the wall all round but at its door.)
  // (Over a cellar the paving is taken out from under the boards to a little past the cellar's round, at the door too
  // (see the terrace's holes in the plan): there the boards run on a pace into the doorway, with their step at their
  // end, and what holds a body up goes as far.)
  const doorWide = halfAt(holes[0], rin) + 6, under = hole ? 0.34 : 0.14;
  for (let j = 0; j < 48; j++) {
    const a0 = j * 7.5, a1 = a0 + 7.5, atDoor = apart(a0 + 3.75, tw.door) <= doorWide;
    ring(TOWER_FLOOR, hole, rin, a0, a1, UP);
    if (hole || !atDoor) ring(TOWER_FLOOR, rin, rin + under, a0, a1, UP);
    if (hole) {
      if (atDoor) wood.quad([P(a0, rin + under, 0), P(a1, rin + under, 0), P(a1, rin + under, TOWER_FLOOR), P(a0, rin + under, TOWER_FLOOR)], [[0, 0], [0.3, 0], [0.3, TOWER_FLOOR], [0, TOWER_FLOOR]], out(a0 + 3.75), tone * 0.8);
      ring(TOWER_FLOOR - 0.06, hole, rin, a0, a1, [0, -1, 0], 0.7);
      wood.quad([P(a0, hole, TOWER_FLOOR - 0.06), P(a1, hole, TOWER_FLOOR - 0.06), P(a1, hole, TOWER_FLOOR), P(a0, hole, TOWER_FLOOR)], [[0, 0], [0.135, 0], [0.135, 0.06], [0, 0.06]], mul(out(a0 + 3.75), -1), tone * 0.7);
      if (j % 2) continue;
      const pts: number[] = [];
      for (const a of [a0, a0 + 15]) for (const r of [hole, rin + under]) for (const y of [-0.2, TOWER_FLOOR]) pts.push(...P(a, r, y));
      put({ t: 'hull', pts, feet: false, surface: 'wood', name: 'tower floor' });
    }
  }
  {
    const half = halfAt(holes[0], rin) + 2;
    wood.quad([P(tw.door - half, rin, 0), P(tw.door + half, rin, 0), P(tw.door + half, rin, TOWER_FLOOR), P(tw.door - half, rin, TOWER_FLOOR)], [[0, 0], [1, 0], [1, TOWER_FLOOR], [0, TOWER_FLOOR]], out(tw.door), tone * 0.8);
  }
  if (!hole) disc('tower floor', -0.2, TOWER_FLOOR, rin);

  yield;
  // ---- the stair round the inside of the wall, and the rail on its open side
  const S = tw.stair, sg = Math.sign(S.sweep), N = Math.round(T.deck / 0.2), da = S.sweep / N, rise = T.deck / N, ri = T.stairIn, ro = rin - 0.02, mid = (ri + ro) / 2;
  /** whether the wall still stands at a place round it, to bear a tread at this height */
  const borne = (a: number, y: number) => rimAt(a) > y + 0.15;
  /** whether enough of the wall stands over the boards for there to be a platform at all */
  let ringed = 0;
  for (let j = 0; j < 48; j++) if (rimAt(j * 7.5 + 3.75) >= T.deck && !(norm360((j * 7.5 + 3.75 - tw.well[0]) * sg) < Math.abs(tw.well[1] - tw.well[0]))) ringed++;
  const decked = ringed >= 14;
  for (let i = 0; i < N; i++) {
    const a0 = S.from + da * i, a1 = a0 + da, y = (i + 1) * rise, lap = sg * 0.6;
    if (!borne((a0 + a1) / 2, y)) continue;
    // (each tread laps the one under it; its boards lie across the way up)
    const top = [P(a0 - lap, ri, y), P(a1, ri, y), P(a1, ro, y), P(a0 - lap, ro, y)], am = (a0 + a1) / 2, uv = top.map((p): UV => [dot(p, round(am)), dot(p, out(am))]);
    wood.quad(top, uv, UP, tone);
    wood.quad(top.map((p): V3 => [p[0], p[1] - 0.05, p[2]]), uv, [0, -1, 0], tone * 0.8);
    for (const [a, face] of [[a0 - lap, -sg], [a1, sg]] as [number, number][]) wood.quad([P(a, ri, y - 0.05), P(a, ro, y - 0.05), P(a, ro, y), P(a, ri, y)], [[ri, 0], [ro, 0], [ro, 0.05], [ri, 0.05]], mul(round(a), face), tone * 0.85);
    wood.quad([P(a0 - lap, ri, y - 0.05), P(a1, ri, y - 0.05), P(a1, ri, y), P(a0 - lap, ri, y)], [[0, 0], [0.26, 0], [0.26, 0.05], [0, 0.05]], mul(out((a0 + a1) / 2), -1), tone * 0.85);
    // the string under its open edge
    timber(wood, P(a0, ri + 0.05, y - rise - 0.15), P(a1, ri + 0.05, y - 0.15), 0.06, 0.2, tone * 0.9);
  }
  // (the rail goes up with it as far as the platform lets it; from there the platform's own rail stands over the stair)
  const posts: V3[] = [];
  for (let i = 0; i < N && (i + 1) * rise + RAIL.top < T.deck - 0.12 && borne(S.from + da * (i + 2.5), (i + 3) * rise); i += 2) posts.push(P(S.from + da * (i + 0.5), ri + 0.04, (i + 1) * rise));
  for (let i = 0; i + 1 < posts.length; i++) railRun(wood, put, posts[i], posts[i + 1], tone, 'tower stair rail');
  // what is walked on: the slope under the treads, in short lengths round the wall, from a tread before the first
  // to a tread short of the last (a round stair is a twisted slope: each length of it is flat, and near enough)
  for (let j = 0; j < 2 * N; j++) {
    const am = S.from - da + (da / 2) * (j + 0.5), y = (T.deck * (j + 0.5)) / (2 * N), tilt = Math.atan(rise / 2 / (mid * rad(Math.abs(da) / 2)));
    if (!borne(am + da, y)) continue;
    const z = unit(add(mul(round(am), sg * Math.cos(tilt)), mul(UP, Math.sin(tilt)))), x = mul(out(am), sg), yy = cross(z, x);
    put(boxSolid(sub(P(am, mid, y), mul(yy, SLOPE_HALF)), [x, yy, z], [(rin - ri) / 2, SLOPE_HALF, rin * Math.tan(rad(Math.abs(da) / 4)) + 0.03], true, 'wood', 'tower stair'));
  }

  yield;
  // ---- the platform under the rim: all of the round but the well the stair comes up in
  const D = T.deck, well0 = tw.well[0], wide = Math.abs(tw.well[1] - tw.well[0]), inWell = (a: number) => norm360((a - well0) * sg) < wide;
  // (a tower that has lost its wall has lost its platform: the head of its stair is all there is up there)
  if (!decked) {
    if (borne(tw.well[1] - da / 2, D - 0.3)) {
      const pts: number[] = [];
      for (const a of [tw.well[1] - da, tw.well[1] - da / 2, tw.well[1]]) for (const r of [ri, rin]) for (const y of [D - 0.1, D]) pts.push(...P(a, r, y));
      put({ t: 'hull', pts, feet: true, surface: 'wood', name: 'tower stair head' });
    }
    return;
  }
  // (its middle is round by the same forty-eight lengths as the ring of boards about it: by twenty-four, a slit a finger wide was left between the two at every other length, and the sky was seen up through the platform)
  for (let j = 0; j < 48; j++) for (const [y, face, k] of [[D, UP, 1], [D - 0.1, [0, -1, 0], 0.75]] as [number, V3, number][]) ring(y, 0, ri, j * 7.5, (j + 1) * 7.5, face, k);
  // (where the wall has come down the boards it bore have gone with it: the platform is ragged there, and open)
  const boarded = (j: number) => { const a = (((j % 48) + 48) % 48) * 7.5 + 3.75; return rimAt(a) >= D && !inWell(a); };
  for (let j = 0; j < 48; j++) {
    const a0 = j * 7.5, a1 = a0 + 7.5;
    if (!boarded(j)) {
      // (the edge of the boards: round the well, and round where they have gone)
      wood.quad([P(a0, ri, D - 0.1), P(a1, ri, D - 0.1), P(a1, ri, D), P(a0, ri, D)], [[0, 0], [0.15, 0], [0.15, 0.1], [0, 0.1]], out(a0 + 3.75), tone * 0.8);
      continue;
    }
    ring(D, ri, rin, a0, a1, UP);
    ring(D - 0.1, ri, rin, a0, a1, [0, -1, 0], 0.75);
    // THE BOARDS HAVE ENDS. Wherever the ring of them stops (at the well, at the head of the stair, at each place the
    // wall has come down) the thickness of the boards is closed: open, the top of the platform was seen from under
    // it, from behind, with the sky through it (2026-10-14: the gaps seen from below in a tower).
    for (const [a, to, there] of [[a0, -1, boarded(j - 1)], [a1, 1, boarded(j + 1)]] as [number, number, boolean][]) if (!there) wood.quad([P(a, ri, D - 0.1), P(a, rin, D - 0.1), P(a, rin, D), P(a, ri, D)], [[ri, 0], [rin, 0], [rin, 0.1], [ri, 0.1]], mul(round(a), to), tone * 0.8);
  }
  // two joists under it, where no head comes up: across the middle square to the well, and along the side away from it
  const wc = well0 + (sg * wide) / 2;
  timber(wood, P(wc + 90, rin, D - 0.21), P(wc - 90, rin, D - 0.21), 0.18, 0.22, tone * 0.85);
  timber(wood, P(wc + 180 - 57, rin, D - 0.21), P(wc + 180 + 57, rin, D - 0.21), 0.18, 0.22, tone * 0.85);
  // what holds a body up there: the middle of it, and the ring in lengths; the last tread of the stair is one of them
  disc('tower platform', D - 0.1, D, ri + 0.02);
  for (let j = 0; j < 48; j++) {
    if (inWell(j * 7.5 + 3.75) || rimAt(j * 7.5 + 3.75) < D) continue;
    const pts: number[] = [];
    for (const a of [j * 7.5, j * 7.5 + 7.5]) for (const r of [ri, rin]) for (const y of [D - 0.1, D]) pts.push(...P(a, r, y));
    put({ t: 'hull', pts, feet: false, surface: 'wood', name: 'tower platform' });
  }
  {
    const pts: number[] = [];
    for (const a of [tw.well[1] - da, tw.well[1] - da / 2, tw.well[1]]) for (const r of [ri, rin]) for (const y of [D - 0.1, D]) pts.push(...P(a, r, y));
    put({ t: 'hull', pts, feet: true, surface: 'wood', name: 'tower stair head' });
  }
  // a rail along the open edge of the middle, over the stair, and one across the ring where the well begins.
  // (What stops a body goes down as well as up: whoever is on the last of the stair does not step in under the boards.)
  for (let k = 0, m = 4, each = (wide - Math.abs(da)) / m; k < m; k++) railRun(wood, put, P(well0 + sg * k * each, ri - 0.05, D), P(well0 + sg * (k + 1) * each, ri - 0.05, D), tone, 'tower platform rail', 1.3);
  railRun(wood, put, P(well0 - sg * 1.5, ri - 0.05, D), P(well0 - sg * 1.5, rin - 0.04, D), tone, 'tower platform rail');
}

/** a tower's door to the terrace, how wide its windows are, and how wide a hole where its stones have gone */
export const TOWER_DOOR = { w: 1.0, h: 2.1 };

export const SLIT_WIDE = 0.7;

export const LOST_WIDE = 0.62;
