// Inside Pokrov's corner towers, as drawn (2026-10-19): the room's wall and ceiling, the doorway's lining, the floor,
// the stair and its parapet, and the hatch's edges. They are the walls, floor and steps of the plan
// (src/sim/pokrov-towers.ts), drawn in the kit's own two stuffs at the kit's own scale: its limewashed wall for what is
// built and trodden (the room, the doorway, the ceiling, the floor), its dressed stone for the steps and their parapet
// (as the kit's own flights are).
// They go into the kit's own shapes (kitMeshes' `add`): no draw of their own, and near and far with the walls.

import { arcs, faceAt, noseAt, towerHatch, towerSteps, TOWER_ROOM, type TowerPlace } from '../sim/pokrov-towers';

/** the kit's picture, so many to the metre on the tower's wall and on its trim (measured on the model: one in 11.6 m and in 4.5 m, before the town's sets are laid three times as often) */
const WALL = 0.0863, TRIM = 0.2236;
const D = Math.PI / 180;
type P = [number, number, number];

export function towerInsides(towers: TowerPlace[]): Record<string, number[][]> {
  const wall: number[][] = [], trim: number[][] = [];
  /** a triangle, turned to face `n` whichever way its corners were given; each corner with its place on the picture */
  const tri = (to: number[][], a: P, b: P, c: P, n: P, uv: (p: P) => [number, number]) => {
    const g = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const order = g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0 ? [a, c, b] : [a, b, c];
    for (const p of order) to.push([...p, ...n, ...uv(p)]);
  };
  const quad = (to: number[][], a: P, b: P, c: P, d: P, n: P, uv: (p: P) => [number, number]) => {
    tri(to, a, b, c, n, uv);
    tri(to, a, c, d, n, uv);
  };
  for (const t of towers) {
    const R = TOWER_ROOM, f = t.foot, at = (a: number, r: number, y: number): P => [t.x + Math.cos(a) * r, f + y, t.z + Math.sin(a) * r];
    const out = (a: number): P => [Math.cos(a), 0, Math.sin(a)], inward = (a: number): P => [-Math.cos(a), 0, -Math.sin(a)];
    /** along the way round, the way the stair climbs */
    const round = (a: number): P => [-Math.sin(a) * t.dir, 0, Math.cos(a) * t.dir];
    const flat = (k: number) => (p: P): [number, number] => [p[0] * k, p[2] * k];
    /** on a round face about the angle m: along it and up it (the angle kept near m, so a face over the turn's seam is not smeared) */
    const roundUV = (k: number, r: number, m: number) => (p: P): [number, number] => {
      const a = Math.atan2(p[2] - t.z, p[0] - t.x);
      return [(m + Math.atan2(Math.sin(a - m), Math.cos(a - m))) * r * k, (p[1] - f) * k];
    };
    const [h0, h1] = towerHatch(t), lo = Math.min(h0, h1), hi = Math.max(h0, h1), edge = Math.asin(R.door.half / R.r), base = t.door - Math.PI;
    const inHatch = (a: number) => [-2 * Math.PI, 0, 2 * Math.PI].some((w) => a + w > lo + 1e-6 && a + w < hi - 1e-6);
    // ---- the room's wall, its ceiling, and the hatch's edges: round the room in pieces of 7.5 degrees, cut at the doorway's sides and the hatch's pieces
    // (over the hatch, only the hatch's own pieces: the platform is cut along them, and a wall turned anywhere else
    // left a crack between the two along the hatch's edge, seen from above)
    const marks = [...Array.from({ length: 48 }, (_, k) => t.door + k * 7.5 * D).filter((a) => !inHatch(a)), t.door - edge, t.door + edge, ...arcs(h0, h1, 10 * D)]
      .map((a) => base + ((((a - base) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)));
    const ends = [...[...new Set(marks.map((a) => a.toFixed(6)))].map(Number).sort((p, q) => p - q), base + 2 * Math.PI];
    for (let k = 0; k + 1 < ends.length; k++) {
      const a0 = ends[k], a1 = ends[k + 1], m = (a0 + a1) / 2;
      if (a1 - a0 < 1e-4) continue;
      const door = Math.abs(Math.atan2(Math.sin(m - t.door), Math.cos(m - t.door))) < edge, hatch = inHatch(m);
      const y0 = door ? R.door.h : 0, y1 = hatch ? R.top : R.ceil;
      quad(wall, at(a0, R.r, y0), at(a1, R.r, y0), at(a1, R.r, y1), at(a0, R.r, y1), inward(m), roundUV(WALL, R.r, m));
      // (each corner turned to the room's middle as the round wall is, so it is lit as round, not in flat bands)
      for (let v = wall.length - 6; v < wall.length; v++) {
        const a = Math.atan2(wall[v][2] - t.z, wall[v][0] - t.x);
        wall[v].splice(3, 3, -Math.cos(a), 0, -Math.sin(a));
      }
      // the ceiling, over the room to the wall, or at the hatch to its inner edge
      const reach = hatch ? R.rail - 0.02 : R.r;
      tri(wall, at(a0, 0, R.ceil), at(a0, reach, R.ceil), at(a1, reach, R.ceil), [0, -1, 0], flat(WALL));
      if (hatch) {
        // (the platform's edge along the hatch's inner side: seen from the room and from the stair)
        const e = [at(a0, reach, R.ceil), at(a1, reach, R.ceil), at(a1, reach, R.top), at(a0, reach, R.top)] as const;
        quad(wall, ...e, inward(m), roundUV(WALL, reach, m));
        quad(wall, ...e, out(m), roundUV(WALL, reach, m));
      }
    }
    // (the hatch's two ends: where it starts over the stair, and where the stair's head comes up to the platform)
    const endFace = (a: number, n: P) => quad(wall, at(a, R.rail - 0.02, R.ceil), at(a, R.r, R.ceil), at(a, R.r, R.top), at(a, R.rail - 0.02, R.top), n, (p) => [Math.hypot(p[0] - t.x, p[2] - t.z) * WALL, (p[1] - f) * WALL]);
    endFace(h0, round(h0));
    endFace(h1, round(h1).map((v) => -v) as P);
    // ---- the floor: the room's, and the doorway's out to the tower's face
    const FLOOR = 0.03;
    for (let k = 0; k < 48; k++) {
      const a0 = t.door + (k - 0.5) * 7.5 * D, a1 = a0 + 7.5 * D;
      // (the piece in front of the doorway reaches exactly to where the doorway's floor begins)
      if (k === 0) tri(wall, at(0, 0, FLOOR), at(t.door - edge, R.r, FLOOR), at(t.door + edge, R.r, FLOOR), [0, 1, 0], flat(WALL));
      else if (k === 1) tri(wall, at(0, 0, FLOOR), at(t.door + edge, R.r, FLOOR), at(a1, R.r, FLOOR), [0, 1, 0], flat(WALL));
      else if (k === 47) tri(wall, at(0, 0, FLOOR), at(a0, R.r, FLOOR), at(t.door - edge, R.r, FLOOR), [0, 1, 0], flat(WALL));
      else tri(wall, at(0, 0, FLOOR), at(a0, R.r, FLOOR), at(a1, R.r, FLOOR), [0, 1, 0], flat(WALL));
    }
    // ---- the doorway: its floor, its two sides out to a finger past the tower's face at every height, its soffit
    const c = Math.cos(t.door), s = Math.sin(t.door), h = R.door.half, a0 = Math.sqrt(R.r * R.r - h * h);
    const pass = (along: number, across: number, y: number): P => [t.x + c * along - s * across, f + y, t.z + s * along + c * across];
    const reach = (y: number) => Math.sqrt(faceAt(y) ** 2 - h * h) + 0.03;
    quad(wall, pass(a0, -h, FLOOR), pass(reach(0), -h, FLOOR), pass(reach(0), h, FLOOR), pass(a0, h, FLOOR), [0, 1, 0], flat(WALL));
    for (const side of [-1, 1]) {
      const n: P = [s * side, 0, -c * side], ys = [0, 1.5, 2, R.door.h];
      const sideUV = (p: P): [number, number] => [((p[0] - t.x) * c + (p[2] - t.z) * s) * WALL, (p[1] - f) * WALL];
      for (let k = 0; k + 1 < ys.length; k++) quad(wall, pass(a0, side * h, ys[k]), pass(reach(ys[k]), side * h, ys[k]), pass(reach(ys[k + 1]), side * h, ys[k + 1]), pass(a0, side * h, ys[k + 1]), n, sideUV);
    }
    quad(wall, pass(a0, -h, R.door.h), pass(reach(R.door.h), -h, R.door.h), pass(reach(R.door.h), h, R.door.h), pass(a0, h, R.door.h), [0, -1, 0], flat(WALL));
    // ---- the stair: each step a slab of stone built into the wall, its parapet along its open side
    const steps = towerSteps(t), rise = R.top / R.steps;
    for (const st of steps) {
      const y0 = st.y - R.slab, up: P = [0, 1, 0], m = (st.a0 + st.a1) / 2;
      quad(trim, at(st.a0, R.stair, st.y), at(st.a0, R.r, st.y), at(st.a1, R.r, st.y), at(st.a1, R.stair, st.y), up, flat(TRIM));
      quad(trim, at(st.a0, R.stair, y0), at(st.a0, R.r, y0), at(st.a1, R.r, y0), at(st.a1, R.stair, y0), [0, -1, 0], flat(TRIM));
      const front = round(st.a0).map((v) => -v) as P, back = round(st.a1);
      const faceUV = (p: P): [number, number] => [Math.hypot(p[0] - t.x, p[2] - t.z) * TRIM, (p[1] - f) * TRIM];
      quad(trim, at(st.a0, R.stair, y0), at(st.a0, R.r, y0), at(st.a0, R.r, st.y), at(st.a0, R.stair, st.y), front, faceUV);
      quad(trim, at(st.a1, R.stair, y0), at(st.a1, R.r, y0), at(st.a1, R.r, st.y), at(st.a1, R.stair, st.y), back, faceUV);
      // the parapet over this step: its top along the line of the fronts, its foot along the slabs' undersides
      const top = (a: number) => noseAt(t, a) + R.railUp, foot = (a: number) => Math.max(0, noseAt(t, a) - rise - R.slab);
      for (const [r, n] of [[R.rail, -1], [R.stair, 1]] as const) {
        quad(trim, at(st.a0, r, foot(st.a0)), at(st.a1, r, foot(st.a1)), at(st.a1, r, top(st.a1)), at(st.a0, r, top(st.a0)), (n < 0 ? inward : out)(m), roundUV(TRIM, r, m));
      }
      quad(trim, at(st.a0, R.rail, top(st.a0)), at(st.a0, R.stair, top(st.a0)), at(st.a1, R.stair, top(st.a1)), at(st.a1, R.rail, top(st.a1)), up, flat(TRIM));
      quad(trim, at(st.a0, R.rail, foot(st.a0)), at(st.a0, R.stair, foot(st.a0)), at(st.a1, R.stair, foot(st.a1)), at(st.a1, R.rail, foot(st.a1)), [0, -1, 0], flat(TRIM));
    }
    // (the parapet's two ends)
    const first = steps[0].a0, last = steps[steps.length - 1].a1;
    const railEnd = (a: number, n: P) => quad(trim, at(a, R.rail, Math.max(0, noseAt(t, a) - rise - R.slab)), at(a, R.stair, Math.max(0, noseAt(t, a) - rise - R.slab)), at(a, R.stair, noseAt(t, a) + R.railUp), at(a, R.rail, noseAt(t, a) + R.railUp), n, (p) => [Math.hypot(p[0] - t.x, p[2] - t.z) * TRIM, (p[1] - f) * TRIM]);
    railEnd(first, round(first).map((v) => -v) as P);
    railEnd(last, round(last));
  }
  return { fort_wall: wall, fort_trim: trim };
}
