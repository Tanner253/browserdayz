// What a basement is made of (src/sim/basements.ts says where its rooms, steps and things are): its walls, floors and
// ceilings, a frame of timber round every way through, its flights, and up in the yard the kerb round the open steps
// and the two leaves of the cellar door thrown back on the ground. Everything here stops a body and a shot as the
// houses' own walls do. Made by Buildings.plan, through `kit`, with the houses' own boxes, stuff and stairs.

import * as THREE from 'three';
import { BUILDING_FOOTPRINT, heightAt, type World } from './worldgen';
import { CELLAR, frameToWorld, type Basement, type Room, type Skin } from '../sim/basements';
import type { MatKey } from './buildings';

/** the houses' own tools: a box of a stuff in a frame (solid unless said), and a straight flight of steps along z */
export interface Kit {
  box: (M: THREE.Matrix4, key: Exclude<MatKey, 'glass'>, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, solid?: boolean) => void;
  flight: (M: THREE.Matrix4, plot: string, st: { x0: number; x1: number; foot: number; top: number }, y0: number, y1: number, key: MatKey) => void;
}

const STUFF: Record<Skin, { wall: Exclude<MatKey, 'glass'>; floor: Exclude<MatKey, 'glass'>; ceil: Exclude<MatKey, 'glass'> }> = {
  brick: { wall: 'brick_ext', floor: 'floor_concrete', ceil: 'planks' },
  concrete: { wall: 'concrete', floor: 'floor_concrete', ceil: 'concrete' },
  plaster: { wall: 'int_plaster', floor: 'planks', ceil: 'ceiling' },
};

const T = 0.2;
const DOOR_TOP = 2.05;

/** the stretches of [lo, hi] left when `cuts` are taken out of it */
function spans(lo: number, hi: number, cuts: [number, number][]): [number, number][] {
  let out: [number, number][] = [[lo, hi]];
  for (const [a, b] of cuts) {
    const next: [number, number][] = [];
    for (const [p, q] of out) {
      if (b <= p || a >= q) next.push([p, q]);
      else {
        if (a > p) next.push([p, a]);
        if (b < q) next.push([b, q]);
      }
    }
    out = next;
  }
  return out.filter(([p, q]) => q - p > 0.02);
}

export function buildBasement(world: World, b: Basement, kit: Kit) {
  const M = new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0, b.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot), new THREE.Vector3(1, 1, 1));
  const ground = (lx: number, lz: number) => heightAt(world.heights, ...frameToWorld(b, lx, lz));
  const S = b.rooms[0], f = b.flights[0], w = b.well, dz = Math.sign(f.top - f.foot);
  /** the steps' room: how high its walls stand at a z (the kerb over the ground where it is open; under the earth's line where it is roofed) */
  const open = (z: number) => (dz > 0 ? z > w.z0 - 1e-3 : z < w.z1 + 1e-3);
  const stairTop = (z0: number, z1: number) => {
    const x = (S.x0 + S.x1) / 2, a = ground(S.x0, z0), c = ground(S.x1, z0), e = ground(S.x0, z1), g = ground(S.x1, z1), m = ground(x, (z0 + z1) / 2);
    return open((z0 + z1) / 2) ? Math.max(a, c, e, g, m) + 0.25 : Math.min(a, c, e, g, m) - 0.05;
  };

  // ---- walls: every room's four sides; a side another room of its level shares is made once (by the first of the
  // two), with its ways through left open in it
  b.rooms.forEach((r, i) => {
    const st = STUFF[r.skin], y0 = r.y - CELLAR.slab, y1 = r.y + r.h + CELLAR.slab;
    const sides: { line: 'x' | 'z'; at: number; lo: number; hi: number }[] = [
      { line: 'z', at: r.z0, lo: r.x0, hi: r.x1 },
      { line: 'z', at: r.z1, lo: r.x0, hi: r.x1 },
      { line: 'x', at: r.x0, lo: r.z0, hi: r.z1 },
      { line: 'x', at: r.x1, lo: r.z0, hi: r.z1 },
    ];
    for (const sd of sides) {
      // (the head of the steps is how they are gone into: no wall across it)
      if (r.kind === 'stair' && sd.line === 'z' && Math.abs(sd.at - (dz > 0 ? r.z1 : r.z0)) < 1e-3) continue;
      const skip: [number, number][] = [], cuts: [number, number][] = [];
      b.rooms.forEach((o, j) => {
        if (j === i || o.level !== r.level) return;
        const e = 1e-3;
        if (sd.line === 'x' && (Math.abs(o.x0 - sd.at) < e || Math.abs(o.x1 - sd.at) < e)) {
          const lo = Math.max(sd.lo, o.z0), hi = Math.min(sd.hi, o.z1);
          if (hi - lo > e && j < i) skip.push([lo, hi]);
        }
        if (sd.line === 'z' && (Math.abs(o.z0 - sd.at) < e || Math.abs(o.z1 - sd.at) < e)) {
          const lo = Math.max(sd.lo, o.x0), hi = Math.min(sd.hi, o.x1);
          if (hi - lo > e && j < i) skip.push([lo, hi]);
        }
      });
      for (const d of b.doors) {
        if (d.level !== r.level) continue;
        if (sd.line === 'x' && d.x0 === d.x1 && Math.abs(d.x0 - sd.at) < 1e-3) cuts.push([d.z0, d.z1]);
        if (sd.line === 'z' && d.z0 === d.z1 && Math.abs(d.z0 - sd.at) < 1e-3) cuts.push([d.x0, d.x1]);
      }
      // (a wall runs on half its thickness past each corner, so that two meet without a slit)
      for (const [p, q] of spans(sd.lo - T / 2, sd.hi + T / 2, skip)) {
        const doorCuts = cuts.filter(([a, c]) => c > p && a < q);
        const pieces = spans(p, q, doorCuts);
        const one = (a: number, c: number, ya: number, yb: number) =>
          sd.line === 'x' ? kit.box(M, st.wall, sd.at - T / 2, sd.at + T / 2, ya, yb, a, c) : kit.box(M, st.wall, a, c, ya, yb, sd.at - T / 2, sd.at + T / 2);
        for (const [a, c] of pieces) {
          if (r.kind !== 'stair') {
            one(a, c, y0, y1);
            continue;
          }
          // the steps' room: its walls in lengths of half a metre, each as high as the ground over it says
          if (sd.line === 'z') one(a, c, y0, stairTop(sd.at - 0.25, sd.at + 0.25));
          else for (let z = a; z < c - 1e-3; z += 0.5) one(z, Math.min(c, z + 0.5), y0, stairTop(z, Math.min(c, z + 0.5)));
        }
        // over each way through, the wall from its head to the ceiling, and a frame of timber round it
        for (const [a, c] of doorCuts) {
          const ya = r.y + DOOR_TOP;
          if (r.kind === 'stair') one(a, c, ya, stairTop(sd.line === 'x' ? a : sd.at - 0.25, sd.line === 'x' ? c : sd.at + 0.25));
          else one(a, c, ya, y1);
          const jamb = (u0: number, u1: number, v0: number, v1: number) => (sd.line === 'x' ? kit.box(M, 'trim', sd.at - T / 2 - 0.03, sd.at + T / 2 + 0.03, v0, v1, u0, u1, false) : kit.box(M, 'trim', u0, u1, v0, v1, sd.at - T / 2 - 0.03, sd.at + T / 2 + 0.03, false));
          jamb(a, a + 0.08, r.y, ya);
          jamb(c - 0.08, c, r.y, ya);
          jamb(a, c, ya - 0.08, ya);
        }
      }
    }
  });

  // ---- floors and ceilings
  for (const r of b.rooms) {
    const st = STUFF[r.skin];
    const fl = r.floor === undefined ? [r.z0, r.z1] : r.floor;
    if (fl) kit.box(M, st.floor, r.x0, r.x1, r.y - CELLAR.slab, r.y, Math.min(fl[0], fl[1]), Math.max(fl[0], fl[1]));
    if (r.ceil) kit.box(M, st.ceil, r.x0, r.x1, r.y + r.h, r.y + r.h + CELLAR.slab, r.z0, r.z1);
  }
  // the steps' room is roofed where it is not open, under the earth's line, half a metre at a time; and across the
  // end of the opening a beam stands a hand over the ground, so that the earth's edge there is not seen from under it
  for (let z = S.z0; z < S.z1 - 1e-3; z += 0.5) {
    const z1 = Math.min(S.z1, z + 0.5);
    if (open((z + z1) / 2)) continue;
    const top = stairTop(z, z1);
    kit.box(M, 'concrete', S.x0, S.x1, top - 0.22, top, z, z1);
  }
  const edge = dz > 0 ? w.z0 : w.z1, gEdge = Math.max(ground(S.x0, edge), ground(S.x1, edge));
  kit.box(M, 'concrete', S.x0 - T / 2, S.x1 + T / 2, gEdge - 0.35, gEdge + 0.25, edge - (dz > 0 ? 0.18 : -0.02), edge + (dz > 0 ? 0.02 : 0.18));

  // ---- the steps: down from the yard, and in a deep one the flight between its two levels
  b.flights.forEach((fl, k) => kit.flight(M, `${b.plot}_cellar${k}`, fl, fl.y0, fl.y1, 'concrete'));

  // ---- the cellar door: two leaves of boards thrown back off the kerb, lying on the ground either side of it; where
  // the house's wall is on one side, that leaf is leant up against the wall
  const z0 = Math.min(w.z0, w.z1) + 0.05, z1 = Math.max(w.z0, w.z1) - 0.05, HW = BUILDING_FOOTPRINT[b.type][0] / 2;
  for (const side of [-1, 1]) {
    const xa = side < 0 ? S.x0 - T / 2 - 0.62 : S.x1 + T / 2 + 0.02, xb = xa + 0.6;
    const leaf = (F: THREE.Matrix4, a: number, c: number, y: number) => {
      kit.box(F, 'planks', a, c, y, y + 0.045, z0, z1, false);
      for (const zb of [z0 + 0.25, (z0 + z1) / 2, z1 - 0.3]) kit.box(F, 'trim', a + 0.04, c - 0.04, y + 0.045, y + 0.075, zb - 0.05, zb + 0.05, false);
    };
    const against = b.type !== 'barn' && Math.min(Math.abs(xa), Math.abs(xb)) < HW + 0.05;
    if (!against) {
      leaf(M, xa, xb, Math.max(ground(xa, z0), ground(xb, z0), ground(xa, z1), ground(xb, z1), ground((xa + xb) / 2, (z0 + z1) / 2)) + 0.01);
      continue;
    }
    // (stood on the kerb's edge and leant toward the wall: its foot on the kerb, its head a hand from the wall)
    const edge = side < 0 ? S.x0 - T / 2 : S.x1 + T / 2, toward = Math.sign(-edge) || -side, kerb = Math.max(ground(edge, z0), ground(edge, z1)) + 0.25;
    const tilt = Math.atan2(0.58, Math.max(0.05, Math.abs(edge) - HW - 0.06)), a = toward > 0 ? tilt : Math.PI - tilt;
    const F = M.clone().multiply(new THREE.Matrix4().makeTranslation(edge, kerb, 0)).multiply(new THREE.Matrix4().makeRotationZ(a));
    leaf(F, 0, 0.6, 0);
  }
  // (and in a workshop or a vault, a pipe from the floor up through the ceiling in a corner away from the ways in)
  for (const r of b.rooms) {
    if (r.kind !== 'work' && r.kind !== 'vault') continue;
    const corners: [number, number][] = [[r.x0 + 0.28, r.z0 + 0.28], [r.x1 - 0.28, r.z0 + 0.28], [r.x0 + 0.28, r.z1 - 0.28], [r.x1 - 0.28, r.z1 - 0.28]];
    const clear = corners.find(([x, z]) => !b.doors.some((d) => d.level === r.level && Math.hypot(x - (d.x0 + d.x1) / 2, z - (d.z0 + d.z1) / 2) < 1.4) && !b.things.some((t) => Math.hypot(t.x - x, t.z - z) < 0.9));
    if (!clear) continue;
    const [px, pz] = clear;
    kit.box(M, 'concrete', px - 0.09, px + 0.09, r.y, r.y + r.h + 0.1, pz - 0.09, pz + 0.09);
    for (const y of [r.y + 0.6, r.y + 1.8]) kit.box(M, 'trim', px - 0.11, px + 0.11, y, y + 0.05, pz - 0.11, pz + 0.11, false);
  }
}

/** the frame of a room in the world, as the indoor lights want it */
export function roomVolume(b: Basement, r: Room) {
  const [x, z] = frameToWorld(b, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
  return { x, z, hw: (r.x1 - r.x0) / 2, hd: (r.z1 - r.z0) / 2, rot: b.rot, y0: r.y - 0.2, y1: r.y + r.h };
}
