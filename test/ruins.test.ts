// Checks of the ruined town (src/sim/ruins.ts, src/world/ruins-shape.ts) with nothing drawn: its pieces, the
// ground each is built for, what is solid, where things lie. `npx tsx test/ruins.test.ts`.

import assert from 'node:assert/strict';
import { ALCAZAR, CURTAIN, GATE, GENTLE, LAND, OUTLINE, PIECE_NAMES, RUIN_TIER, SPUR, inside, outside, rampY, rampYGate, ruinAt, ruinFires, ruinFoot, ruinGround, ruinHomes, ruinLocal, ruinLoot, ruinParts, ruinProps, ruinsGround, ruinsLayout, ruinsPlan, wallLength, wallLengths, wallTop, type Flight, type Floor, type Part, type Piece, type Place, type Slab, type V2, type Wall } from '../src/sim/ruins';
import { TILE, ruinShape } from '../src/world/ruins-shape';

let n = 0;
/** what a check found wrong: all of it is said, not the first of it */
let wrong: string[] = [];
const want = (right: unknown, what = 'not so') => {
  if (!right) wrong.push(what);
};
const ok = (name: string, fn: () => void) => {
  wrong = [];
  fn();
  assert.equal(wrong.length, 0, [`${name}:`, ...wrong.slice(0, 24), ...(wrong.length > 24 ? [`and ${wrong.length - 24} more`] : [])].join('\n    '));
  n++;
  console.log('  ok  ' + name);
};
const walls = (piece: Piece) => ruinParts(piece).filter((p): p is Wall => p.t === 'wall');
const flights = (piece: Piece) => ruinParts(piece).filter((p): p is Flight => p.t === 'flight');
const slabY = (s: Slab, x: number, z: number): number | null => {
  // the height of a slab's top over a spot, if the spot is under it: by the two triangles it is drawn as
  const [a, b, c, d] = s.p;
  for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
    const det = (q[2] - r[2]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[2] - r[2]), u = ((q[2] - r[2]) * (x - r[0]) + (r[0] - q[0]) * (z - r[2])) / det, v = ((r[2] - p[2]) * (x - r[0]) + (p[0] - r[0]) * (z - r[2])) / det;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) return u * p[1] + v * q[1] + (1 - u - v) * r[1];
  }
  return null;
};
/** what there is to stand on in a piece at a spot, at or a little under a height: the top of a floor, a slab, a stair or a wall (null: only the ground) */
function standing(piece: Piece, x: number, z: number, y: number): number | null {
  let best: number | null = null;
  const take = (top: number | null) => {
    if (top !== null && top <= y + 0.35 && (best === null || top > best)) best = top;
  };
  for (const p of ruinParts(piece)) {
    if (p.hidden) continue;
    if (p.t === 'floor' && inside(x, z, p.pts) && !(p.holes ?? []).some((h) => inside(x, z, h))) take(p.y);
    else if (p.t === 'slab') take(slabY(p, x, z));
    else if (p.t === 'wall') for (const l of wallLengths(p)) if (inside(x, z, [l.l0, l.l1, l.r1, l.r0])) for (const s of l.solids) take(s[2]);
  }
  return best;
}
const P0: Place = { x: 0, y: 0, z: 0, rot: 0 };

ok('a spot of a piece and its place in the world are the same thing said two ways, however the piece is turned', () => {
  const p: Place = { x: 310.5, y: 42, z: -120.25, rot: 1.234 };
  for (const [x, z, y] of [[0, 0, 0], [71.4, 36.3, -7], [-3, 55, 9]]) {
    const [wx, wy, wz] = ruinAt(p, x, z, y), [lx, lz, ly] = ruinLocal(p, wx, wy, wz);
    want(Math.hypot(lx - x, lz - z, ly - y) < 1e-9);
  }
  // (a quarter turn puts what was east of it to the north: as the game turns everything else)
  const [qx, , qz] = ruinAt({ x: 0, y: 0, z: 0, rot: Math.PI / 2 }, 10, 0);
  want(Math.abs(qx) < 1e-9 && Math.abs(qz + 10) < 1e-9);
});

ok('the town as it stood: the palace at the east point, the best wall on the south-east, the gate on the south, the spur to the north', () => {
  const at = Object.fromEntries(ruinsLayout().map((s) => [s.piece, s]));
  want(at.alcazar.x > 70 && Math.abs(at.alcazar.z) < 40);
  want(at.gate.z > 90 && at.spur.z < -80);
  // the measurements: the west front runs fifty-two metres to the tower at (100, 15); the curtain sixty-six to (78, 40)
  const front = ruinAt({ x: at.alcazar.x, y: 0, z: at.alcazar.z, rot: at.alcazar.yaw }, 0, ALCAZAR.B[1]);
  want(Math.hypot(front[0] - 101, front[2] - 16) < 1.5, `the south tower is at ${front}`);
  const end = ruinAt({ x: at.curtain.x, y: 0, z: at.curtain.z, rot: at.curtain.yaw }, CURTAIN.len, 0);
  want(Math.hypot(end[0] - 78, end[2] - 40) < 1.5, `the curtain ends at ${end}`);
  const point = ruinAt({ x: at.alcazar.x, y: 0, z: at.alcazar.z, rot: at.alcazar.yaw }, ...ALCAZAR.C);
  want(Math.hypot(point[0] - 160, point[2] + 27) < 2, `the point is at ${point}`);
  const tip = ruinAt({ x: at.spur.x, y: 0, z: at.spur.z, rot: at.spur.yaw }, SPUR.end.x0 + 3, 0);
  want(Math.hypot(tip[0] + 63, tip[2] + 165) < 3, `the spur ends at ${tip}`);
  // every remnant of the bank's wall stands inside the town's edge
  for (const s of ruinsLayout()) if (s.piece.startsWith('stu')) want(outside(s.x, s.z, OUTLINE) < -1, `${s.piece} at ${s.x}, ${s.z}`);
  assert.equal(ruinsPlan({ x: 5, y: 9, z: 7, rot: 0.3 }).length, ruinsLayout().length);
});

ok('the highest masonry is eleven and a half metres over the town, the keep sixteen tall from its foot in the ditch, the great arch four and a half wide', () => {
  const keep = walls('alcazar').find((w) => w.name === 'keep')!;
  assert.equal(keep.top, ALCAZAR.keep);
  // (each piece stands at its own level in the town: the palace three metres under the top, so its keep comes to the same height over it.
  // Of the town as it stood: the keep in the flat middle, built since, has a tower of its own that stands higher, to see over it all.)
  let highest = -99;
  for (const st of ruinsLayout()) if (st.piece !== 'keep') for (const w of walls(st.piece)) for (const l of wallLengths(w)) for (const s of l.solids) highest = Math.max(highest, s[2] + st.y);
  want(highest <= 11.61 && highest > 11, `highest ${highest}`);
  want(ALCAZAR.keep - ruinGround('alcazar', 3, -6.5).y > 15, 'the keep is not tall from the ditch on its north side');
  const arch = walls('alcazar').find((w) => w.name === 'the great arch')!.openings![0];
  want(arch.arch && Math.abs(arch.w - 4.5) < 0.01 && arch.y1 - arch.w / 2 > 4);
  // and under it a body walks through upright all the way across
  for (const l of wallLengths(walls('alcazar').find((w) => w.name === 'the great arch')!)) if (l.s0 > arch.s - arch.w / 2 - 0.01 && l.s1 < arch.s + arch.w / 2 + 0.01) for (const [f0, f1] of l.solids) want(Math.min(f0, f1) > 4.5, 'the arch is low');
});

ok('a wall is built of lengths that leave nothing out, and is never higher than it was made', () => {
  for (const piece of PIECE_NAMES) for (const w of walls(piece)) {
    const L = wallLengths(w), total = wallLength(w);
    want(L.length > 0, `${piece} ${w.name}: nothing of it`);
    want(Math.abs(L[0].s0) < 1e-6 && Math.abs(L[L.length - 1].s1 - total) < 1e-6, `${piece} ${w.name}: its ends`);
    for (let k = 0; k + 1 < L.length; k++) want(Math.abs(L[k].s1 - L[k + 1].s0) < 1e-6, `${piece} ${w.name}: a gap between two lengths`);
    for (const l of L) {
      const top = wallTop(w, (l.s0 + l.s1) / 2, total);
      for (const [f0, f1, t] of l.solids) want(t <= top + 1e-6 && Math.min(f0, f1) >= w.foot - 1e-6 && t > Math.max(f0, f1), `${piece} ${w.name}: a length of it stands outside the wall`);
    }
  }
});

ok('every wall goes into the ground: its foot is two and a half metres or more under the ground it is built for, all round', () => {
  for (const piece of PIECE_NAMES) for (const w of walls(piece)) {
    for (const l of wallLengths(w)) {
      if (!l.solids.length || Math.min(l.solids[0][0], l.solids[0][1]) > w.foot + 0.01) continue;
      const mx = (l.l0[0] + l.r0[0] + l.l1[0] + l.r1[0]) / 4, mz = (l.l0[1] + l.r0[1] + l.l1[1] + l.r1[1]) / 4;
      for (const [cx, cz] of [l.l0, l.r0, l.l1, l.r1]) {
        // (a hand's breadth in from each corner of the length: a parapet's outer face is the face of the wall it stands on)
        const far = Math.hypot(cx - mx, cz - mz) || 1, x = cx + ((mx - cx) / far) * 0.12, z = cz + ((mz - cz) / far) * 0.12, g = ruinGround(piece, x, z);
        // (what stands on a floor of the piece stands on that; and under the palace's floors the ground is dug out to no purpose of the wall's)
        const on = g.kind === 'dug' ? null : standing(piece, x, z, w.foot + 3.2);
        if (on !== null || g.kind === 'dug') continue;
        want(w.foot <= g.y - 2.5, `${piece} ${w.name} at ${x.toFixed(1)}, ${z.toFixed(1)}: foot ${w.foot}, ground ${g.y.toFixed(2)}`);
      }
    }
  }
});

ok('no stair is a wall: stone ones are under thirty-three degrees, timber ones under forty-seven, and each begins and ends on something', () => {
  for (const piece of PIECE_NAMES) for (const f of flights(piece)) {
    const run = Math.hypot(f.head[0] - f.foot[0], f.head[2] - f.foot[2]), deg = (Math.atan2(f.head[1] - f.foot[1], run) * 180) / Math.PI;
    want(deg > 5 && deg < (f.paint === 'timber' ? 47 : 33), `${piece}: a stair of ${deg.toFixed(1)} degrees`);
    // at its head: something level with it within a pace beyond; at its foot: a floor, or the ground it is built for
    const d: V2 = [(f.head[0] - f.foot[0]) / run, (f.head[2] - f.foot[2]) / run];
    let landed = false;
    for (const [a, s] of [[0.5, 0], [0.9, 0], [0.3, 0.9], [0.3, -0.9], [-0.2, 1.1], [-0.2, -1.1]]) {
      const top = standing(piece, f.head[0] + d[0] * a - d[1] * s, f.head[2] + d[1] * a + d[0] * s, f.head[1]);
      if (top !== null && Math.abs(top - f.head[1]) < 0.3) landed = true;
    }
    want(landed, `${piece}: the stair to ${f.head.map((v) => v.toFixed(1))} comes up to nothing`);
    // (it is come onto from before it, or from either side of its first steps)
    let begun = false, on: number | null = null, g = ruinGround(piece, f.foot[0], f.foot[2]);
    for (const [a, s] of [[-0.6, 0], [0.25, 0.95], [0.25, -0.95]]) {
      const x = f.foot[0] + d[0] * a - d[1] * s, z = f.foot[2] + d[1] * a + d[0] * s;
      on = standing(piece, x, z, f.foot[1]);
      g = ruinGround(piece, x, z);
      if ((on !== null && Math.abs(on - f.foot[1]) < 0.3) || (g.kind !== 'dug' && Math.abs(g.y - f.foot[1]) < 0.9)) begun = true;
    }
    want(begun, `${piece}: the stair from ${f.foot.map((v) => v.toFixed(1))} starts on nothing (floor ${on}, ground ${g.y.toFixed(1)})`);
  }
});

/** is there masonry of the piece at a spot, anywhere in a body's height over a level: any wall but `not` */
function walled(piece: Piece, x: number, z: number, y: number, not?: Wall): string | null {
  for (const w of walls(piece)) {
    if (w === not || w.hidden || w.body === 'none') continue;
    for (const l of wallLengths(w)) if (inside(x, z, [l.l0, l.l1, l.r1, l.r0]) && l.solids.some(([f0, f1, t]) => t > y + 0.45 && Math.min(f0, f1) < y + 1.5)) return w.name ?? 'a wall';
  }
  return null;
}

ok('a stair is come onto from behind its foot: a body has room there, clear of every wall (walking it found two with their feet in a corner)', () => {
  for (const piece of PIECE_NAMES) for (const f of flights(piece)) {
    const run = Math.hypot(f.head[0] - f.foot[0], f.head[2] - f.foot[2]), d: V2 = [(f.head[0] - f.foot[0]) / run, (f.head[2] - f.foot[2]) / run];
    const x = f.foot[0] - d[0] * 0.3, z = f.foot[2] - d[1] * 0.3, in_ = walled(piece, x, z, f.foot[1]);
    want(!in_, `${piece}: the stair from ${f.foot.map((v) => v.toFixed(1))} has ${in_} at its foot`);
    // and over the whole of it, a body's height clear of masonry (a wall across a stair, a lintel too low)
    for (let k = 1; k < 8; k++) {
      const px = f.foot[0] + ((f.head[0] - f.foot[0]) * k) / 8, pz = f.foot[2] + ((f.head[2] - f.foot[2]) * k) / 8, py = f.foot[1] + ((f.head[1] - f.foot[1]) * k) / 8, hit = walled(piece, px, pz, py + 0.1);
      want(!hit, `${piece}: the stair from ${f.foot.map((v) => v.toFixed(1))} goes through ${hit} at ${px.toFixed(1)}, ${pz.toFixed(1)}`);
    }
  }
});

ok('a doorway is a way through: no other wall stands in it or within a step of either side of it (walking it found a door behind an arch\'s jamb)', () => {
  for (const piece of PIECE_NAMES) for (const w of walls(piece)) {
    for (const o of w.openings ?? []) {
      // (doors: openings with a head over them a body can pass under, or open to the sky from a floor's height. Not the slits and the gaps of a parapet)
      if (o.w < 0.9 || o.y1 - o.y0 < 1.8) continue;
      let at = 0, p: V2 | null = null, n: V2 = [0, 0];
      const count = w.closed ? w.pts.length : w.pts.length - 1;
      for (let i = 0; i < count && !p; i++) {
        const a = w.pts[i], b = w.pts[(i + 1) % w.pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (o.s <= at + len + 1e-6) {
          const t = (o.s - at) / len;
          p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
        }
        at += len;
      }
      if (!p) continue;
      // (only where there is something to stand on at its sill on one side or the other: the rest are windows)
      const reach = w.thick / 2 + 0.35, sides = [-1, 1].map((k) => standing(piece, p![0] + n[0] * reach * k, p![1] + n[1] * reach * k, o.y0 + 0.2) ?? ruinGround(piece, p![0] + n[0] * reach * k, p![1] + n[1] * reach * k).y);
      if (!sides.some((y) => Math.abs(y - o.y0) < 0.45)) continue;
      for (let t = -reach; t <= reach + 1e-6; t += 0.1) {
        const hit = walled(piece, p[0] + n[0] * t, p[1] + n[1] * t, o.y0, w);
        want(!hit, `${piece}: ${hit} stands in the doorway of ${w.name} at ${p[0].toFixed(1)}, ${p[1].toFixed(1)}`);
      }
    }
  }
});

/** the ground as the map will have it: the assumed ground sampled on a net of two metres and joined as the map joins it (see heightAt in worldgen.ts) */
function net(ground: (x: number, z: number) => number, ox: number, oz: number) {
  const at = new Map<string, number>(), h = (i: number, j: number) => {
    const key = `${i},${j}`;
    let v = at.get(key);
    if (v === undefined) at.set(key, (v = ground(ox + i * 2, oz + j * 2)));
    return v;
  };
  return (x: number, z: number) => {
    const gx = (x - ox) / 2, gz = (z - oz) / 2, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    if (fx + fz <= 1) return h(i, j) + (h(i + 1, j) - h(i, j)) * fx + (h(i, j + 1) - h(i, j)) * fz;
    return h(i + 1, j + 1) + (h(i, j + 1) - h(i + 1, j + 1)) * (1 - fx) + (h(i + 1, j) - h(i + 1, j + 1)) * (1 - fz);
  };
}

ok('on the map\'s net of two metres, however it falls and however a piece is turned, no ground shows through a floor, a ramp or a stair', () => {
  for (const piece of ['alcazar', 'gate', 'curtain', 'spur'] as Piece[]) {
    const surf = ruinParts(piece).filter((p): p is Floor | Slab | Flight => (p.t === 'floor' || p.t === 'slab' || p.t === 'flight') && !p.hidden);
    for (const [turn, ox, oz] of [[0, 0, 0], [0.4203, 0.7, 1.3], [1.1, 1.9, 0.4], [2.6, 0.31, 1.77]]) {
      const place: Place = { x: 0, y: 0, z: 0, rot: turn };
      const land = net((wx, wz) => {
        const [x, z] = ruinLocal(place, wx, 0, wz);
        return ruinGround(piece, x, z).y;
      }, ox, oz);
      const under = (x: number, z: number, y: number, what: string) => {
        const [wx, , wz] = ruinAt(place, x, z);
        want(land(wx, wz) <= y - 0.04, `${piece}, turned ${turn}: the ground (${land(wx, wz).toFixed(2)}) shows through ${what} (${y.toFixed(2)}) at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      };
      for (const p of surf) {
        if (p.t === 'flight') {
          for (let k = 0; k <= 8; k++) under(p.foot[0] + ((p.head[0] - p.foot[0]) * k) / 8, p.foot[2] + ((p.head[2] - p.foot[2]) * k) / 8, p.foot[1] + ((p.head[1] - p.foot[1]) * k) / 8 + 0.1, 'a stair');
          continue;
        }
        const pts: V2[] = p.t === 'floor' ? p.pts : p.p.map(([x, , z]): V2 => [x, z]);
        const x0 = Math.min(...pts.map((q) => q[0])), x1 = Math.max(...pts.map((q) => q[0])), z0 = Math.min(...pts.map((q) => q[1])), z1 = Math.max(...pts.map((q) => q[1]));
        for (let x = x0 + 0.05; x < x1; x += 0.45) for (let z = z0 + 0.05; z < z1; z += 0.45) {
          if (!inside(x, z, pts) || (p.t === 'floor' && (p.holes ?? []).some((h) => inside(x, z, h)))) continue;
          under(x, z, p.t === 'floor' ? p.y : slabY(p, x, z)!, p.name ?? p.t);
        }
      }
    }
  }
});

ok('and no cut in the ground shows outside the wall that hides it: against every outer face the net lies where the ground was meant to', () => {
  // (a pace out from the face of every wall that stands in ground it does not mind the height of: the net's ground there
  // is the ground asked for, to within what a net of two metres makes of a bank)
  for (const piece of ['alcazar', 'gate'] as Piece[]) for (const [turn, ox, oz] of [[0, 0, 0], [0.9, 1.1, 0.3], [2.2, 0.5, 1.6]]) {
    const place: Place = { x: 0, y: 0, z: 0, rot: turn };
    const land = net((wx, wz) => {
      const [x, z] = ruinLocal(place, wx, 0, wz);
      return ruinGround(piece, x, z).y;
    }, ox, oz);
    const foot = ruinFoot(piece);
    for (const w of walls(piece)) for (const l of wallLengths(w)) for (const [a, b] of [[l.l0, l.r0], [l.r0, l.l0]]) {
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, x = a[0] + ((a[0] - b[0]) / d) * 0.6, z = a[1] + ((a[1] - b[1]) / d) * 0.6, g = ruinGround(piece, x, z);
      // (only outside the piece's own floors and pits, and where there is no masonry over the spot)
      if (g.hold === 2 || outside(x, z, foot) < -4 === false && g.hold === 0) continue;
      if (g.kind === 'dug' || standing(piece, x, z, 99) !== null) continue;
      // (what was meant, within a mesh of the net of the spot: where the ground itself is steep, the net is somewhere on the steep)
      let lo = g.y, hi = g.y;
      for (let k = 0; k < 8; k++) {
        const q = ruinGround(piece, x + Math.cos(k * 0.785) * 2.2, z + Math.sin(k * 0.785) * 2.2).y;
        lo = Math.min(lo, q);
        hi = Math.max(hi, q);
      }
      const [wx, , wz] = ruinAt(place, x, z);
      want(land(wx, wz) > lo - 0.6 && land(wx, wz) < hi + 0.6, `${piece} ${w.name}, turned ${turn}: a trench or a bank at ${x.toFixed(1)}, ${z.toFixed(1)}: ${land(wx, wz).toFixed(2)} for ${g.y.toFixed(2)}`);
    }
  }
});

ok('the way in from the great arch is level through the gate and then one slope down to the upper court; the gate\'s passage climbs eight metres in two turns', () => {
  want(Math.abs(rampY(0) - rampY(3)) < 1e-9 && Math.abs(rampY(ALCAZAR.ramp.foot) - ALCAZAR.upper) < 1e-9);
  // (measured over the slope itself: the upper court is a metre and a half under the gate now, not four and a half)
  const deg = (Math.atan2(rampY(ALCAZAR.ramp.level) - rampY(ALCAZAR.ramp.foot), ALCAZAR.ramp.foot - ALCAZAR.ramp.level) * 180) / Math.PI;
  want(deg > 8 && deg < 20, `the ramp is ${deg.toFixed(1)} degrees`);
  want(Math.abs(rampYGate(3) - GATE.floor.turn) < 1e-9 && rampYGate(-7) === GATE.floor.top);
  want(GATE.floor.top - GATE.causeway.y > 8);
  // the causeway stands three metres over the moat's floor, level with the far lip
  assert.equal(GATE.causeway.y, LAND.plain);
  want(Math.abs(GATE.causeway.y - LAND.moat - 3) < 0.01);
});

ok('the land as the town stood on it: a top, a ditch on the south-west with a far bank lower than the top, and nothing asked of the net steeper than it can carry', () => {
  // (across the south-west side, where nothing stands: from well inside the edge to well beyond the ditch)
  const a = OUTLINE[22], b = OUTLINE[23], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, l = Math.hypot(b[0] - a[0], b[1] - a[1]), out: V2 = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
  const y = (d: number) => ruinsGround(mx + out[0] * d, mz + out[1] * d).y;
  want(y(-40) > -2.5 && y(-40) < 1.5, `the top is at ${y(-40)}`);
  let floor = 99, steepest = 0;
  for (let d = -30; d <= 90; d += 0.5) {
    if (d > 4 && d < 60) floor = Math.min(floor, y(d));
    steepest = Math.max(steepest, Math.abs(y(d + 0.5) - y(d)) / 0.5);
  }
  want(floor < -10 && floor > -12.5, `the ditch's floor is at ${floor.toFixed(2)}`);
  want(y(85) > floor + 0.5 && y(85) < -6, `the fields beyond are at ${y(85).toFixed(2)}`);
  want(steepest <= GENTLE * 1.08, `the steepest of it is ${steepest.toFixed(2)} (rise over run)`);
});

ok('what is found there: on the third step in the town and the fourth in the palace, a camp and a dig and three nests, each on something', () => {
  let all = 0;
  for (const piece of PIECE_NAMES) {
    const loot = ruinLoot(piece, P0);
    all += loot.length;
    for (const l of loot) {
      assert.equal(l.tier, RUIN_TIER[piece]);
      want(l.usage.length > 0 && l.usage.every((u) => ['Hunting', 'Farm', 'Industrial', 'Military'].includes(u)));
      const on = standing(piece, l.x, l.z, l.y), g = ruinGround(piece, l.x, l.z);
      want((on !== null && Math.abs(on + 0.02 - l.y) < 0.06) || (g.kind !== 'dug' && Math.abs(g.y + 0.02 - l.y) < 0.06), `${piece}: a thing at ${l.x}, ${l.y}, ${l.z} lies on nothing (floor ${on}, ground ${g.y.toFixed(2)})`);
      // and not in a wall: a hand's breadth clear of every length that stands higher than it
      for (const w of walls(piece)) for (const len of wallLengths(w)) if (len.solids.some((s) => s[2] > l.y + 0.2 && Math.min(s[0], s[1]) < l.y + 0.3)) want(!inside(l.x, l.z, [len.l0, len.l1, len.r1, len.r0]), `${piece}: a thing at ${l.x}, ${l.z} is in ${w.name}`);
    }
  }
  want(all > 90 && all < 160, `${all} places`);
  const nests = ruinLoot('alcazar', P0).filter((l) => l.arms === 'guns');
  assert.equal(nests.length, 3);
  want(nests.every((l) => l.y > 7));
  // a turned and lifted piece has the same things in the same places of itself
  const p: Place = { x: 200, y: 31, z: -50, rot: 2 }, a = ruinLoot('gate', P0), b = ruinLoot('gate', p);
  a.forEach((l, k) => {
    const [x, z, y] = ruinLocal(p, b[k].x, b[k].y, b[k].z);
    want(Math.hypot(x - l.x, z - l.z, y - l.y) < 0.01);
  });
});

ok('fires to light, things to search, and the infected kept to the low ground', () => {
  let fires = 0;
  for (const piece of PIECE_NAMES) {
    fires += ruinFires(piece, P0).length;
    for (const q of ruinProps(piece, P0)) want(Number.isFinite(q.x + q.y + q.z) && q.kind.length > 0);
    for (const h of ruinHomes(piece, P0)) for (const [x, y, z] of h.inside ?? []) {
      const on = standing(piece, x, z, y);
      want(on !== null && Math.abs(on - y) < 0.05, `${piece}: an infected would stand on nothing at ${x}, ${y}, ${z}`);
      want(y < 0, 'the infected are given a high place');
    }
  }
  want(fires >= 8, `${fires} fires`);
});

ok('what is drawn of it: under a hundred and twenty thousand triangles for every piece once, no face that is nothing, no picture pulled out of shape', () => {
  let tris = 0, solids = 0;
  for (const piece of PIECE_NAMES) {
    const shape = ruinShape(piece);
    solids += shape.solids.length;
    for (const d of shape.drawn) {
      tris += d.tris;
      const P = d.geometry.getAttribute('position'), U = d.geometry.getAttribute('uv'), N = d.geometry.getAttribute('normal'), C = d.geometry.getAttribute('color');
      want(!d.geometry.getIndex() && P.count === d.tris * 3, `${piece}: its points are not three to a face`);
      for (let t = 0; t < P.count; t += 3) {
        // (which picture a face is laid with is in the fourth part of its colour: stone, gravel or sand)
        const [a, b, c] = [t, t + 1, t + 2], tile = d.stuff === 'timber' ? TILE.timber : C.getW(a) > 0.75 ? TILE.sand : C.getW(a) > 0.25 ? TILE.earth : TILE.stone;
        const e1 = [P.getX(b) - P.getX(a), P.getY(b) - P.getY(a), P.getZ(b) - P.getZ(a)], e2 = [P.getX(c) - P.getX(a), P.getY(c) - P.getY(a), P.getZ(c) - P.getZ(a)];
        const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0], area = Math.hypot(nx, ny, nz) / 2;
        want(area > 1e-7, `${piece}: a face of nothing`);
        // (its normal is the way it faces: what lights it is what it is seen by)
        want(nx * N.getX(a) + ny * N.getY(a) + nz * N.getZ(a) > 0, `${piece}: a face lit from behind`);
        if (area < 0.15) continue;
        const uv = (Math.abs((U.getX(b) - U.getX(a)) * (U.getY(c) - U.getY(a)) - (U.getX(c) - U.getX(a)) * (U.getY(b) - U.getY(a))) / 2) * tile * tile, k = uv / area;
        want(k > 0.45 && k < 2.2, `${piece} ${d.stuff}: a picture stretched ${k.toFixed(2)} times`);
      }
    }
  }
  // (the town as it stood was under 110,000 and 1,400; the keep in the flat middle, built since, is some 18,000 and 250 of its own)
  want(tris < 128000, `${tris} triangles`);
  want(solids < 1650, `${solids} things that stop a body`);
});

ok('the faces of a wall look outward: from a pace outside either face of a length, that face is seen from its front', () => {
  // (a length of each that nothing else stands near: ten metres along the curtain, between two towers of the north wall, the middle of a remnant)
  for (const [piece, where] of [['curtain', 10], ['north', 51], ['stubA', 3.5]] as [Piece, number][]) {
    const stone = ruinShape(piece).drawn.find((d) => d.stuff === 'masonry' && !d.near)!, P = stone.geometry.getAttribute('position'), N = stone.geometry.getAttribute('normal');
    const w = walls(piece)[0], L = wallLengths(w), mid = L.find((l) => l.s1 > where)!, cx = (mid.l0[0] + mid.l1[0] + mid.r0[0] + mid.r1[0]) / 4, cz = (mid.l0[1] + mid.l1[1] + mid.r0[1] + mid.r1[1]) / 4;
    let seen = 0;
    for (let i = 0; i < P.count; i++) {
      // (low on it: higher up there is a parapet on its top, whose inner face looks back over the wall)
      if (Math.abs(N.getY(i)) > 0.3 || Math.hypot(P.getX(i) - cx, P.getZ(i) - cz) > w.thick || P.getY(i) > (typeof w.top === 'number' ? w.top : 0) - 1.2) continue;
      // (a point of a side face of that length: its normal points away from the wall's middle line)
      const out = (P.getX(i) - cx) * N.getX(i) + (P.getZ(i) - cz) * N.getZ(i);
      if (Math.abs(N.getX(i) * (mid.l1[0] - mid.l0[0]) + N.getZ(i) * (mid.l1[1] - mid.l0[1])) > 0.3) continue;
      want(out > 0, `${piece}: a face of ${w.name} looks into the wall`);
      seen++;
    }
    want(seen > 0, `${piece}: no face found`);
  }
});

const kinds = new Map<Part['t'], number>();
for (const piece of PIECE_NAMES) for (const p of ruinParts(piece)) kinds.set(p.t, (kinds.get(p.t) ?? 0) + 1);
console.log(`\n${n} checks passed (${[...kinds].map(([k, v]) => `${v} ${k}s`).join(', ')})`);
