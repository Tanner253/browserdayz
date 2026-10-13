// The road bridge as it is built (see src/sim/bridge.ts for what a bridge is, in figures, and src/world/worldgen.ts
// for where one stands): a reinforced-concrete road bridge of the kind the country it stands in built by the
// thousand. A slab on precast beams, three spans on two piers, each pier two columns with rounded noses under a
// crosshead; a seat in each bank for the end of the beams, with wing walls stepping up the bank either side of it;
// kerbs, a narrow footway each side, and a steel railing that a car has been through.
//
// It is built from the bridge's two ends and from the ground, and from nothing else: the piers go down to whatever
// ground is under them, the seats stand where the bank has fallen far enough away under the deck to show them, and
// the walls step with the ground they stand in. No place on the map is written here.
//
// It is drawn in three things, one for each stuff it is made of (concrete, asphalt, steel), each one shape with its
// weathering in the colour of its corners: nothing here is worked out again after it is made. What stops a body, a
// wheel and a shot is a list of boxes (`bridgeBoxes`), worked out from the same plan with no drawing in it, so that
// a test can ask where the deck is.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import { BRIDGE, deckWidth, spanOf, type Bridge } from '../sim/bridge';
import type { Atmosphere } from './atmosphere';
import { heightAt, type World } from './worldgen';

/**
 * What a bridge is made to, beyond the figures everything has to agree about (BRIDGE): metres.
 *   tile    – how much concrete one laying of the concrete's picture covers; road – and of the asphalt's (the road's own)
 *   pad     – the bearing strip the beams sit on, on a crosshead and on a seat
 *   fascia  – the edge beam of the deck: how far in from the deck's edge it begins, how far out it stands, how far
 *             under the slab it hangs
 *   kerb    – the flat of a kerb stone behind its sloped face (the sloped face is as wide as the kerb is high)
 *   beam    – half the width of a beam's web, and of the bulb at its foot
 *   cap     – a pier's crosshead: how thick along the bridge, how deep over the columns, how deep at its ends
 *   column  – half the flat of a column's face, and the radius of its nose (which is half its thickness)
 *   tie     – the beam between a pier's two columns: one for every `every` metres the pier is tall
 *   footing – what a pier stands on: how long along the bridge, how far its top stands over the ground its columns
 *             stand in, how far under the lowest ground about it it goes
 *   seat    – the wall in the bank the end beams sit on: how wide its shelf is, how much of its face is to show
 *             under the beams (taking one end of it with the other) before the bank comes up to it, how far down
 *             it goes, and the furthest from the deck's end it may stand, looking for a place where it shows
 *   wing    – the walls either side of a seat: turned back from the seat's own line by `turn`, `long` in all in so
 *             many `steps`, each step's top `over` the highest ground it stands in and its foot `into` the lowest
 *   rail    – how far in from the deck's edge the railing stands, about how far apart its posts are, how far it
 *             goes on onto each bank, how thick what stops a body is and how far over the top rail that stands
 *   gap     – where the car went through: about how wide, and how far along from the first end (of the whole)
 *   ramp    – how long the wedge is that carries a wheel from the ground onto the deck
 */
const MAKE = {
  tile: 3.2,
  road: 5,
  pad: 0.12,
  fascia: { in: 0.24, out: 0.06, drop: 0.22 },
  kerb: 0.12,
  beam: { web: 0.1, bulb: 0.28 },
  cap: { thick: 1.7, deep: 1.2, end: 0.65 },
  column: { flat: 0.4, nose: 0.7 },
  tie: { deep: 1, thick: 0.9, every: 9 },
  footing: { long: 3.4, proud: 0.2, into: 1.2 },
  seat: { shelf: 0.9, show: 1, down: 6, most: 10 },
  wing: { turn: Math.PI / 6, long: 9, steps: 5, thick: 0.5, over: 0.8, into: 1.6 },
  rail: { inset: 0.12, bay: 2.2, onto: 6, thick: 0.12, over: 0.1 },
  gap: { wide: 7, at: 0.4 },
  ramp: 4,
};
/** the two sides of a bridge: to the left of the way from its first end to its second, and to the right */
const SIDES = [1, -1] as const;

/** one of the boxes that stop a body, a wheel and a shot: its middle, half its size each way, how it is turned about the upright and then tipped about its own x */
export interface BridgeBox {
  name: string;
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
  tilt?: number;
  surface: 'asphalt' | 'concrete' | 'metal';
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Where everything of one bridge is, as numbers: what is drawn and what is solid are both made from this, so the
 * two cannot disagree.
 *
 * Its own measure is `lx` to the left of the way from the first end to the second, `ly` over the road's surface
 * (the deck runs straight from the one end's height to the other's, and `ly` is measured plumb from that line),
 * and `lz` along from the first end, over the ground. (To the left and not, as `onBridge` has it, to the right:
 * left, up and along are a right hand's three, and shapes turned into the world by a left hand's are inside out.)
 */
function planOf(b: Bridge, groundAt: (x: number, z: number) => number) {
  const len = spanOf(b) || 1, ux = (b.bx - b.ax) / len, uz = (b.bz - b.az) / len, slope = (b.by - b.ay) / len;
  const half = deckWidth() / 2;
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [b.ax + uz * lx + ux * lz, b.ay + slope * lz + ly, b.az - ux * lx + uz * lz];
  /** how high the ground is at a spot, in the bridge's own measure (under the road's surface it is less than nothing) */
  const ground = (lx: number, lz: number) => groundAt(b.ax + uz * lx + ux * lz, b.az - ux * lx + uz * lz) - (b.ay + slope * lz);
  /** the underside of the beams, and the shelf a seat keeps for them */
  const under = -(BRIDGE.slab + BRIDGE.beam), shelf = under - MAKE.pad;
  const beamGap = (half * 2 - 1.7) / Math.max(1, BRIDGE.beams - 1);
  const colAt = half / 2, capWide = half * 2 - 0.5, footWide = half * 2 - 0.7;

  // The two ends. The deck's end is at the top of its bank, and there the ground is as high as the road: a wall
  // under the very end of the deck would never be seen, and the beams would run into the grass. So the seat stands
  // out from the end, at the first place where the bank has fallen far enough under the beams for its face to show,
  // and the deck between is carried on the block behind it.
  const ends = ([[0, 1], [len, -1]] as const).map(([z, into]) => {
    const zt = (t: number) => z + into * t;
    const across = (t: number) => [-1, -0.5, 0, 0.5, 1].map((k) => ground(k * (half - 0.3), zt(t)));
    // (A bank seldom lies square to a bridge. The seat stands where the ground is under its shelf all the way
    // across, so that no beam runs into the bank, and under it by what is to show on the whole: where the bank
    // lies askew, more of its face shows at one end of it than at the other.)
    const most = Math.max(MAKE.seat.shelf + 0.5, Math.min(MAKE.seat.most, len / BRIDGE.spans - 5));
    let face = most;
    for (let t = MAKE.seat.shelf + 0.5; t < most; t += 0.25) {
      const g = across(t);
      if (Math.max(...g) <= shelf - 0.15 && g.reduce((p, q) => p + q) / g.length <= shelf - MAKE.seat.show) {
        face = t;
        break;
      }
    }
    const bottom = Math.min(shelf - MAKE.seat.down, Math.min(...across(face)) - 1.5);
    // the wing walls: out from each corner of the seat and back toward the bank, each step as high as its own ground
    const wings: { x: number; z: number; turn: number; long: number; bottom: number; top: number; off: number }[] = [];
    const step = MAKE.wing.long / MAKE.wing.steps, c = Math.cos(MAKE.wing.turn), s = Math.sin(MAKE.wing.turn);
    for (const sx of SIDES) {
      const dx = sx * c, dz = -into * s;
      for (let k = 0; k < MAKE.wing.steps; k++) {
        // (from inside the seat's corner, far enough back that no corner of the first step stands out of the seat's face)
        const x = sx * (half - 0.3) + dx * (k + 0.5) * step, zz = zt(face - 0.45) + dz * (k + 0.5) * step;
        let hi = -1e9, lo = 1e9;
        for (let j = -2; j <= 2; j++) {
          for (const off of [-0.25, 0.25]) {
            const g = ground(x + (dx * j * step) / 4 - dz * off, zz + (dz * j * step) / 4 + dx * off);
            hi = Math.max(hi, g);
            lo = Math.min(lo, g);
          }
        }
        // (never over the footway: where the bank stands higher than the road the wall is under it, and is not made)
        const top = Math.min(BRIDGE.kerb, hi + MAKE.wing.over), foot = lo - MAKE.wing.into;
        if (top - foot > 0.4) wings.push({ x, z: zz, turn: Math.atan2(dx, dz), long: step, bottom: foot, top, off: k * step });
      }
    }
    // The ground a wheel comes off, a little way out along the road; and the ground each footway runs down into
    // (just under it: the footway's end goes into the ground, and does not lie in one plane with it). Neither is
    // taken as higher than the bridge: where a bank stands over the road these lie level, and the bank covers them.
    const ramp = Math.min(0, ground(0, zt(-MAKE.ramp)));
    const walk = SIDES.map((sx) => Math.min(BRIDGE.kerb, ground(sx * (BRIDGE.road / 2 + BRIDGE.walk / 2), zt(-MAKE.rail.onto)) - 0.04));
    return { z, into, face, bottom, wings, ramp, walk };
  });

  // The piers, between the spans. A pier stands on a bank as often as on level ground: its footing is a block
  // let into the bank, its top a little over the ground where the columns stand (so that the columns stand on
  // something that is seen, and its downhill face shows as far as the bank falls away from it) and its foot well
  // under the lowest ground about it.
  const piers: { z: number; top: number; soffit: number; footTop: number; footBottom: number; ties: number[]; ground: number[] }[] = [];
  for (let i = 1; i < BRIDGE.spans; i++) {
    const z = (len * i) / BRIDGE.spans;
    let low = 1e9;
    for (let p = -2; p <= 2; p++) for (let q = -2; q <= 2; q++) low = Math.min(low, ground((p / 4) * footWide, z + (q / 4) * MAKE.footing.long));
    const top = under - MAKE.pad, soffit = top - MAKE.cap.deep, stood = SIDES.map((sx) => ground(sx * colAt, z));
    const footTop = Math.min(Math.max(...stood) + MAKE.footing.proud, soffit - 1), footBottom = Math.min(low - MAKE.footing.into, footTop - 1.6);
    const clear = soffit - footTop, n = Math.floor(clear / MAKE.tie.every);
    piers.push({ z, top, soffit, footTop, footBottom, ties: Array.from({ length: n }, (_, j) => footTop + (clear * (j + 1)) / (n + 1)), ground: stood });
  }

  // The beams of each span: from seat to pier, pier to pier, pier to seat, a hand's breadth between one span's and the next's.
  const spans: [number, number][] = [];
  for (let i = 0; i < BRIDGE.spans; i++) {
    spans.push([i === 0 ? ends[0].face - MAKE.seat.shelf + 0.08 : piers[i - 1].z + 0.04, i === BRIDGE.spans - 1 ? len - (ends[1].face - MAKE.seat.shelf + 0.08) : piers[i].z - 0.04]);
  }

  // The railing: a post at every `bay`. A car has been through it on the side that lies to greater z (on a bridge
  // that runs along z, the right-hand side): so many bays are gone, and the posts either side of the hole lean out
  // over the drop. On the other side one post has been hit and has not gone.
  const bays = Math.max(1, Math.round(len / MAKE.rail.bay)), bay = len / bays;
  const open = Math.max(1, Math.round(MAKE.gap.wide / bay));
  const first = Math.min(bays - open - 1, Math.max(1, Math.round((MAKE.gap.at * len - (open * bay) / 2) / bay + 1e-6)));
  const gap = bays >= open + 4 ? { side: -ux > 1e-6 ? 1 : -1, from: first, to: first + open } : null;
  const hit = gap && bays >= 8 ? { side: -gap.side, at: Math.round(bays * 0.72) } : null;
  /** whether a post is gone; and how far one leans, out over the edge and along the bridge (radians) */
  const gone = (sx: number, k: number) => !!gap && sx === gap.side && k > gap.from && k < gap.to;
  const lean = (sx: number, k: number): [number, number] => {
    if (gap && sx === gap.side) {
      if (k === gap.from) return [0.6, 0.25];
      if (k === gap.to) return [0.9, -0.35];
      if (k === gap.from - 1) return [0.12, 0];
      if (k === gap.to + 1) return [0.2, 0];
    }
    if (hit && sx === hit.side) {
      if (k === hit.at) return [0.42, 0.1];
      if (Math.abs(k - hit.at) === 1) return [0.1, 0];
    }
    return [0, 0];
  };
  /** the stretches of a side's railing that stand, along the deck: the hole is left open */
  const runs = (sx: number): [number, number][] => (gap && sx === gap.side ? [[0, gap.from * bay], [gap.to * bay, len]] : [[0, len]]);
  // a drain through the edge of the deck at every fourth post
  const drains: number[] = [];
  for (let k = 2; k < bays; k += 4) drains.push(k * bay);

  return { len, ux, uz, slope, yaw: Math.atan2(ux, uz), half, at, ground, under, shelf, beamGap, colAt, capWide, footWide, ends, piers, spans, bays, bay, gap, gone, lean, runs, drains };
}
type Plan = ReturnType<typeof planOf>;

/**
 * What of a bridge stops a body, a wheel and a shot: boxes, each with its middle, half its size each way, how far
 * it is turned about the upright (`yaw`, radians) and, where it is tipped, how far about its own x after that
 * (`tilt`). No drawing and no physics is needed to ask.
 *
 * The deck is one box from end to end, its top the road's surface, so that a wheel meets no joint in it. Each
 * footway is a box a kerb higher, with a sloped one along its edge for a wheel to ride up; the railing is a thin
 * tall box for each stretch of it that stands (the hole the car left is open: that is what it is for); the beams of
 * each span are one box, so that a round from below stops where the bridge is; every column, crosshead, tie,
 * footing, seat and wing wall is a box; and at each end a thin wedge carries a wheel from the ground onto the deck.
 *
 * @param groundAt how high the ground is at a spot of the world
 */
export function bridgeBoxes(b: Bridge, groundAt: (x: number, z: number) => number): BridgeBox[] {
  const P = planOf(b, groundAt), out: BridgeBox[] = [];
  const R2 = BRIDGE.road / 2, K = BRIDGE.kerb, C = MAKE.column, R = MAKE.rail;
  /** a box that stands plumb: its middle at (lx, lz), from `bottom` to `top`, turned `turn` from the bridge's own line */
  const plumb = (name: string, surface: BridgeBox['surface'], lx: number, lz: number, hx: number, hz: number, bottom: number, top: number, turn = 0) => {
    const [x, y, z] = P.at(lx, (bottom + top) / 2, lz);
    out.push({ name, x, y, z, hx, hy: (top - bottom) / 2, hz, yaw: P.yaw + turn, surface });
  };
  /** a box that lies along the bridge: from lx0 to lx1 across, its top on the line from (z0, y0) to (z1, y1), `thick` under that (z0 the lesser) */
  const lying = (name: string, surface: BridgeBox['surface'], lx0: number, lx1: number, z0: number, y0: number, z1: number, y1: number, thick: number) => {
    const mid = (lx0 + lx1) / 2, [xa, ya, za] = P.at(mid, y0, z0), [xb, yb, zb] = P.at(mid, y1, z1);
    const run = Math.hypot(xb - xa, zb - za), pitch = Math.atan2(yb - ya, run), back = (thick / 2) * Math.sin(pitch);
    const box: BridgeBox = { name, x: (xa + xb) / 2 + back * P.ux, y: (ya + yb) / 2 - (thick / 2) * Math.cos(pitch), z: (za + zb) / 2 + back * P.uz, hx: Math.abs(lx1 - lx0) / 2, hy: thick / 2, hz: Math.hypot(run, yb - ya) / 2, yaw: P.yaw, surface };
    if (Math.abs(pitch) > 1e-9) box.tilt = -pitch;
    out.push(box);
  };

  lying('deck', 'asphalt', -P.half, P.half, 0, 0, P.len, 0, BRIDGE.slab);
  for (const sx of SIDES) {
    lying('footway', 'concrete', sx * (R2 + K), sx * P.half, 0, K, P.len, K, K + 0.1);
    // The kerb's sloped face, from the road's surface at the edge of the road up to the footway: a box turned to
    // lie along the bridge on its own x, so that the one tip it may have rolls it. (On a deck that climbs, a box
    // cannot be rolled and pitched both: there it is cut into lengths, each level, none a finger out.)
    const pieces = P.slope ? Math.min(80, Math.ceil((P.len * Math.abs(P.slope)) / 0.02)) : 1, T = 0.06, r = Math.SQRT1_2;
    for (let i = 0; i < pieces; i++) {
      const z0 = (P.len * i) / pieces, z1 = (P.len * (i + 1)) / pieces;
      const [x, y, z] = P.at(sx * (R2 + K / 2 + (T / 2) * r), K / 2 - (T / 2) * r, (z0 + z1) / 2);
      out.push({ name: 'kerb', x, y, z, hx: (z1 - z0) / 2, hy: T / 2, hz: (K * Math.SQRT2) / 2, yaw: P.yaw + Math.PI / 2, tilt: (-sx * Math.PI) / 4, surface: 'concrete' });
    }
    // (from just under the footway's top to a hand over the top rail: it is to stop a jeep, which rides up on its springs)
    const x = sx * (P.half - R.inset);
    for (const [z0, z1] of P.runs(sx)) lying('rail', 'metal', x - R.thick / 2, x + R.thick / 2, z0, K + BRIDGE.rail + R.over, z1, K + BRIDGE.rail + R.over, BRIDGE.rail + R.over + 0.05);
  }
  const beams = (P.beamGap * (BRIDGE.beams - 1)) / 2 + MAKE.beam.bulb;
  for (const [z0, z1] of P.spans) lying('beams', 'concrete', -beams, beams, z0, -BRIDGE.slab, z1, -BRIDGE.slab, BRIDGE.beam);

  for (const p of P.piers) {
    // (a column is cast into its footing: it goes down through it, under the ground wherever the ground is)
    for (const sx of SIDES) plumb('column', 'concrete', sx * P.colAt, p.z, C.flat + C.nose, C.nose, p.footBottom, p.soffit);
    // (the crosshead in two: all its depth over the columns, and the shallower whole of it, out to its ends)
    plumb('cap', 'concrete', 0, p.z, P.colAt + C.flat + C.nose, MAKE.cap.thick / 2, p.soffit, p.top);
    plumb('cap', 'concrete', 0, p.z, P.capWide / 2, MAKE.cap.thick / 2, p.top - MAKE.cap.end, p.top);
    for (const y of p.ties) plumb('tie', 'concrete', 0, p.z, P.colAt, MAKE.tie.thick / 2, y - MAKE.tie.deep / 2, y + MAKE.tie.deep / 2);
    plumb('footing', 'concrete', 0, p.z, P.footWide / 2, MAKE.footing.long / 2, p.footBottom, p.footTop);
  }

  for (const e of P.ends) {
    const zt = (t: number) => e.z + e.into * t, back = e.face - MAKE.seat.shelf;
    plumb('abutment', 'concrete', 0, zt(back / 2), P.half - 0.06, back / 2, e.bottom, -BRIDGE.slab);
    plumb('seat', 'concrete', 0, zt(back + MAKE.seat.shelf / 2), P.half - 0.06, MAKE.seat.shelf / 2, e.bottom, P.shelf);
    for (const w of e.wings) plumb('wing', 'concrete', w.x, w.z, MAKE.wing.thick / 2, w.long / 2, w.bottom, w.top, w.turn);
    // The road lies a hand's breadth over the ground and the deck a hand's breadth over that: left so, a wheel
    // would meet the deck's end as a step. A thin wedge, from the ground a little way out to the deck's own top.
    const out0 = zt(-MAKE.ramp), outward = out0 < e.z;
    lying('approach', 'asphalt', -R2, R2, outward ? out0 : e.z, outward ? e.ramp : 0, outward ? e.z : out0, outward ? 0 : e.ramp, 0.12);
    SIDES.forEach((sx, q) => {
      // each footway runs down into the bank, and the railing goes with it to a block of concrete at its end
      const far = zt(-R.onto), near: [number, number] = [e.z, K], off: [number, number] = [far, e.walk[q]], [p0, p1] = far < e.z ? [off, near] : [near, off];
      const x = sx * (P.half - R.inset);
      lying('approach footway', 'concrete', sx * R2, sx * (P.half + MAKE.fascia.out), p0[0], p0[1], p1[0], p1[1], 0.5);
      lying('approach rail', 'metal', x - R.thick / 2, x + R.thick / 2, p0[0], p0[1] + BRIDGE.rail + R.over, p1[0], p1[1] + BRIDGE.rail + R.over, BRIDGE.rail + R.over + 0.05);
      plumb('rail end', 'concrete', x, zt(-(R.onto + 0.2)), 0.2, 0.25, e.walk[q] - 0.8, e.walk[q] + BRIDGE.rail);
    });
  }
  return out;
}

// ------------------------------------------------------------------ shapes

type RGB = readonly [number, number, number];
/** what a corner of a shape is coloured: by where it is in the bridge's own measure, and which way its face looks */
type Tone = (x: number, y: number, z: number, n: THREE.Vector3) => RGB;

const grey = (v: number): RGB => [v, v, v];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// What the concrete's picture is multiplied by. Under the deck no rain washes it and no sun bleaches it; where
// water runs it is dark, and brown under iron; where it stands in the ground it is the ground's colour, and a hand
// over the ground the lime has come out of it, white.
const SHADE: RGB = [0.7, 0.7, 0.72], DAMP: RGB = [0.5, 0.5, 0.46], RUST: RGB = [0.56, 0.4, 0.28], LIME: RGB = [1.3, 1.3, 1.24], EARTH: RGB = [0.6, 0.54, 0.44], MOSS: RGB = [0.55, 0.62, 0.42];
// And the steel's own colours: it has no picture. Old paint, rust, and steel a car has scraped bare.
const PAINT: RGB = [0.3, 0.38, 0.4], RUSTED: RGB = [0.3, 0.17, 0.1], BARE: RGB = [0.4, 0.38, 0.36], DARK: RGB = [0.16, 0.16, 0.17];

const asc = (p: number, q: number) => p - q;
/** places to cut a shape at, in order, none nearer the one before it than `least` (the first and the last are kept) */
function tidy(values: number[], least = 1e-3): number[] {
  const all = [...values].sort(asc), out = [all[0]];
  for (const v of all) if (v - out[out.length - 1] >= least) out.push(v);
  const last = all[all.length - 1];
  if (last - out[out.length - 1] > 1e-9) {
    if (out.length > 1) out[out.length - 1] = last;
    else out.push(last);
  }
  return out;
}

/**
 * A box, cut through at every place given along each of its three ways (each list in order). Three's own box, cut
 * evenly and its corners then moved to the places: its faces look the way three made them look. The cuts are there
 * to carry colour: a streak under a drain needs a corner where the streak is.
 */
function cutBox(xs: number[], ys: number[], zs: number[]) {
  const g = new THREE.BoxGeometry(1, 1, 1, xs.length - 1, ys.length - 1, zs.length - 1), p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, xs[Math.round((p.getX(i) + 0.5) * (xs.length - 1))], ys[Math.round((p.getY(i) + 0.5) * (ys.length - 1))], zs[Math.round((p.getZ(i) + 0.5) * (zs.length - 1))]);
  }
  return g;
}

/** half a round column, upright, for the nose of a pier's column: on the +x side of (cx, cz) or the -x, cut at the heights given; its picture goes round it at the size the flat faces have it */
function nose(cx: number, cz: number, r: number, ys: number[], side: number) {
  const g = new THREE.CylinderGeometry(r, r, 1, 6, ys.length - 1, true, side > 0 ? 0 : Math.PI, Math.PI);
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const y = ys[Math.round((p.getY(i) + 0.5) * (ys.length - 1))], arc = uv.getX(i) * Math.PI * r;
    p.setXYZ(i, p.getX(i) + cx, y, p.getZ(i) + cz);
    uv.setXY(i, (side > 0 ? cx + arc : cx - (Math.PI * r - arc)) / MAKE.tile, y / MAKE.tile);
  }
  return g;
}

/** a bar of steel from one point to another, `wide` across and `deep` the other way */
function strut(a: THREE.Vector3, c: THREE.Vector3, wide: number, deep: number) {
  const way = c.clone().sub(a), long = way.length();
  const g = new THREE.BoxGeometry(wide, long, deep).translate(0, long / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), way.divideScalar(long)));
  return g.translate(a.x, a.y, a.z);
}

/** A shape's picture laid on it in metres, by which way each face looks: so nothing is stretched, and the picture runs on from one piece to the next. */
function lay(g: THREE.BufferGeometry, tile: number) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
    else if (ax >= az) uv.setXY(i, p.getZ(i) / tile, p.getY(i) / tile);
    else uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
  }
}

/**
 * Every shape of one bridge, in the bridge's own measure (see `planOf`), sorted by the stuff it is made of.
 * @param seed what makes this bridge's stains its own
 */
function shapes(P: Plan, seed: number) {
  const concrete: THREE.BufferGeometry[] = [], steel: THREE.BufferGeometry[] = [];
  const rnd = (a: number, c = 0) => {
    const s = Math.sin(a * 127.1 + c * 311.7 + seed) * 43758.5453;
    return s - Math.floor(s);
  };
  const { len, half } = P, R2 = BRIDGE.road / 2, K = BRIDGE.kerb, F = MAKE.fascia, slab = BRIDGE.slab;
  /**
   * One piece: its picture laid on it (or its own kept, where it has been given one), its corners coloured, and
   * then, if it was made lying somewhere else, moved to where it stands.
   */
  const put = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, tone: Tone, own = false, move?: THREE.Matrix4) => {
    if (!own) lay(g, MAKE.tile);
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), col = new Float32Array(p.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) col.set(tone(p.getX(i), p.getY(i), p.getZ(i), v.fromBufferAttribute(n, i)), i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (move) g.applyMatrix4(move);
    list.push(g.index ? g.toNonIndexed() : g);
  };
  /** from a to c on one side of the bridge (a the nearer its middle), in order */
  const span = (sx: number, a: number, c: number) => (sx > 0 ? [a, c] : [-c, -a]);
  /** how wet the edge of the deck is at a place along it: all of it right under a drain, none `reach` from one */
  const drip = (z: number, sx: number, reach = 0.32) => {
    let w = 0;
    for (const d of P.drains) w = Math.max(w, (1 - smooth(0.06, reach, Math.abs(z - d))) * (0.55 + 0.45 * rnd(d, sx)));
    return w;
  };
  const posts = (step: number) => {
    const at = [0, len];
    for (let k = step; k < P.bays; k += step) at.push(k * P.bay);
    return at;
  };

  // ---- the deck: the slab, and along each edge of it the edge beam, the kerb stones and the footway's paving
  // (the slab stops a finger short of each end: its end and the edge beams' are not two faces in one plane)
  put(concrete, cutBox([-half, half], [-slab, -0.04], [0.01, len - 0.01]), (_x, _y, _z, n) => (n.y < -0.5 ? SHADE : grey(0.9)));
  for (const sx of SIDES) {
    // The edge beam, cut about every drain: under each, on its outer face and its underside, what the water has left.
    const cuts = posts(2);
    for (const d of P.drains) cuts.push(d - 0.32, d - 0.06, d + 0.06, d + 0.32);
    put(concrete, cutBox(span(sx, half - F.in, half + F.out), [-slab - F.drop, -0.1, K], tidy(cuts)), (_x, y, z, n) => {
      const pour = grey(0.96 + 0.1 * rnd(Math.round(z / 4.4), sx)), wet = drip(z, sx);
      if (n.y > 0.5) return mix(pour, DAMP, 0.2);
      if (n.y < -0.5) return mix(SHADE, RUST, wet * 0.8);
      if (n.x * sx < 0) return SHADE;
      return mix(pour, RUST, wet * (y < 0 ? 1 : 0.2));
    });
    for (const d of P.drains) {
      put(steel, new THREE.CylinderGeometry(0.045, 0.045, 0.3, 5).rotateZ(Math.PI / 2).translate(sx * (half + F.out + 0.11), -0.16, d), () => RUSTED, true);
    }
    // The kerb: its face to the road sloped, as what a wheel meets there is (see `bridgeBoxes`).
    const stone = new THREE.Shape([[R2, -0.04], [R2 + K, K], [R2 + K + MAKE.kerb, K], [R2 + K + MAKE.kerb, -0.04]].map(([x, y]) => new THREE.Vector2(sx * x, y)));
    put(concrete, new THREE.ExtrudeGeometry(stone, { depth: len, steps: Math.max(1, Math.round(len / 5.5)), bevelEnabled: false }), (_x, _y, z, n) => grey((1 + 0.12 * rnd(Math.round(z), 7 + sx)) * (n.y > 0.9 ? 1 : 0.8)));
    // (the paving lies a little under the kerb and the edge beam either side of it: it was laid between them)
    put(concrete, cutBox(span(sx, R2 + K + MAKE.kerb, half - F.in), [-0.04, K - 0.012], tidy(posts(2))), (_x, _y, z) => grey(0.86 + 0.16 * rnd(Math.round(z), 11 + sx)));
  }

  // ---- the beams of each span, and the cross-beams that tie them: over each bearing and at mid-span
  const B = MAKE.beam, yb = P.under, tied = (P.beamGap * (BRIDGE.beams - 1)) / 2;
  P.spans.forEach(([z0, z1], j) => {
    for (let k = 0; k < BRIDGE.beams; k++) {
      const x = (k - (BRIDGE.beams - 1) / 2) * P.beamGap, outer = k === 0 ? -1 : k === BRIDGE.beams - 1 ? 1 : 0;
      // a precast beam: a bulb at its foot, a web, its head in the slab
      const section = [[-B.bulb, yb], [B.bulb, yb], [B.bulb, yb + 0.2], [B.web, yb + 0.42], [B.web, -slab + 0.02], [-B.web, -slab + 0.02], [-B.web, yb + 0.42], [-B.bulb, yb + 0.2]];
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(section.map(([px, py]) => new THREE.Vector2(x + px, py))), { depth: z1 - z0, steps: outer ? 8 : 3, bevelEnabled: false }).translate(0, 0, z0);
      const own = 0.76 + 0.1 * rnd(k, j);
      put(concrete, g, (_px, py, z, n) => {
        // Dark toward its ends, where the joint over it leaks, with lime on its foot there; and the face of an
        // outer beam, which the weather reaches, paler, with the spray of the drains on it.
        const end = 1 - smooth(0.3, 3, Math.min(z - z0, z1 - z)), lit = outer !== 0 && n.x * outer > 0.5;
        let c: RGB = grey(lit ? own + 0.16 : n.y < -0.5 ? own - 0.08 : own);
        c = mix(c, DAMP, end * (0.45 + 0.4 * rnd(k * 3 + j, Math.round(z))));
        if (lit) c = mix(c, RUST, drip(z, outer, 1.8) * 0.55);
        return py < yb + 0.3 ? mix(c, LIME, 0.3 * end * rnd(k, j + 9)) : c;
      });
    }
    for (const zc of [z0 + 0.5, (z0 + z1) / 2, z1 - 0.5]) put(concrete, cutBox([-tied - 0.02, tied + 0.02], [yb + 0.32, -slab], [zc - 0.11, zc + 0.11]), () => SHADE);
  });

  // ---- the piers
  P.piers.forEach((p, i) => {
    const Cp = MAKE.cap, C = MAKE.column, z0 = p.z - Cp.thick / 2, z1 = p.z + Cp.thick / 2, shoulder = P.colAt + C.flat + C.nose;
    // The crosshead: all its depth over the columns, tapering under each end. It is cut at uneven places across,
    // and at each the joint over it has leaked a streak of its own strength down its two long faces.
    const lines = [-P.capWide / 2, P.capWide / 2, -shoulder, shoulder];
    for (let x = -P.capWide / 2 + 0.5; x < P.capWide / 2 - 0.3; x += 0.45 + 0.6 * rnd(x, i)) lines.push(x);
    const xs = tidy(lines, 0.2);
    const cap: Tone = (x, y, _z, n) => {
      if (n.y > 0.5) return mix(grey(0.8), DAMP, 0.4);
      if (n.y < -0.5) return SHADE;
      return mix(grey(0.98), DAMP, (0.2 + 0.8 * rnd(Math.round(x * 8), 20 + i)) * (1 - (0.55 * (p.top - y)) / Cp.deep));
    };
    put(concrete, cutBox(xs, [p.top - Cp.end, p.top], [z0, z1]), cap);
    put(concrete, cutBox(xs.filter((x) => Math.abs(x) <= shoulder + 1e-6), [p.soffit, p.top - Cp.end], [z0, z1]), cap);
    for (const sx of SIDES) {
      const taper = new THREE.Shape([new THREE.Vector2(sx * shoulder, p.top - Cp.end), new THREE.Vector2((sx * P.capWide) / 2, p.top - Cp.end), new THREE.Vector2(sx * shoulder, p.soffit)]);
      put(concrete, new THREE.ExtrudeGeometry(taper, { depth: Cp.thick, bevelEnabled: false }).translate(0, 0, z0), cap);
    }
    // (the two strips the beams sit on: one for the ends of each span)
    for (const s of [-1, 1]) put(concrete, cutBox([-tied - 0.4, tied + 0.4], [p.top, P.under], tidy([p.z + s * 0.2, p.z + s * 0.64])), () => grey(0.7));

    // The columns: flat to the spans, a round nose to each side. Cut where their colour changes: the foot damp and
    // the ground's colour, lime a hand over it, and from the crosshead down what has run off it.
    SIDES.forEach((sx, q) => {
      const cx = sx * P.colAt, g = p.ground[q];
      const lifts = [p.footTop, g - 0.1, g + 0.4, g + 0.9, g + 2.2, (g + 2.2 + p.soffit - 5) / 2, p.soffit - 5, p.soffit - 1.5, p.soffit];
      const ys = tidy(lifts.filter((y) => y >= p.footTop && y <= p.soffit), 0.25);
      const tone: Tone = (x, y) => {
        let c: RGB = grey(0.93 + 0.1 * rnd(Math.round(y / 3), 30 + i + q));
        c = mix(c, DAMP, (1 - smooth(0.3, 5.2, p.soffit - y)) * (0.25 + 0.6 * rnd(Math.round(x * 3), 40 + i)));
        c = mix(c, LIME, (1 - smooth(0.25, 1.3, Math.abs(y - (g + 0.9)))) * 0.45);
        return mix(c, EARTH, 1 - smooth(0, 0.6, y - g));
      };
      put(concrete, cutBox([cx - C.flat, cx + C.flat], ys, [p.z - C.nose, p.z + C.nose]), tone);
      for (const side of [1, -1]) put(concrete, nose(cx + side * C.flat, p.z, C.nose, ys, side), tone, true);
    });
    for (const y of p.ties) {
      put(concrete, cutBox([-P.colAt, P.colAt], [y - MAKE.tie.deep / 2, y + MAKE.tie.deep / 2], [p.z - MAKE.tie.thick / 2, p.z + MAKE.tie.thick / 2]), (_x, _y, _z, n) => (n.y > 0.5 ? mix(grey(0.8), MOSS, 0.4) : n.y < -0.5 ? SHADE : grey(0.95)));
    }
    // (the footing: what shows of it is its downhill face and its top, and both have the bank's earth washed over them)
    put(concrete, cutBox([-P.footWide / 2, P.footWide / 2], [p.footBottom, p.footTop], [p.z - MAKE.footing.long / 2, p.z + MAKE.footing.long / 2]), (_x, y, _z, n) => (n.y > 0.5 ? mix(grey(0.85), EARTH, 0.35) : mix(grey(0.86), EARTH, 0.25 + 0.5 * smooth(0, 1.6, p.footTop - y))));
  });

  // ---- the two ends: the seat and the block behind it (one shape, an L from the side), the wing walls, and what
  // carries the footways and the railing on onto the bank
  P.ends.forEach((e, i) => {
    const zt = (t: number) => e.z + e.into * t, back = e.face - MAKE.seat.shelf, wide = 2 * (half - 0.06);
    // (its back a finger in from the deck's end: the end of the edge beams is in that plane)
    const side = new THREE.Shape([[0.02, e.bottom], [e.face, e.bottom], [e.face, P.shelf], [back, P.shelf], [back, -slab], [0.02, -slab]].map(([t, y]) => new THREE.Vector2(zt(t), y)));
    // (drawn from the side and pushed across the bridge: turned, so that what was drawn across the page lies along the bridge)
    const g = new THREE.ExtrudeGeometry(side, { depth: wide, steps: 8, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(wide / 2, 0, 0);
    put(concrete, g, (x, y, _z, n) => {
      if (n.y > 0.5) return mix(grey(0.75), DAMP, 0.5);
      if (Math.abs(n.x) > 0.5) return grey(0.95 + 0.06 * rnd(i, 51));
      // the face under the beams, and the wall behind their ends: the joint over it leaks down both
      return mix(grey(1), DAMP, (0.25 + 0.7 * rnd(Math.round(x * 2), 50 + i)) * (1 - 0.6 * smooth(0, 3, P.shelf - y)));
    });
    put(concrete, cutBox([-tied - 0.4, tied + 0.4], [P.shelf, P.under], tidy([zt(back + 0.2), zt(back + 0.7)])), () => grey(0.7));
    for (const w of e.wings) {
      // (made lying along its own length, so far along it as it is along the wall: no two steps have the same piece of the picture)
      const move = new THREE.Matrix4().makeRotationY(w.turn).setPosition(w.x, 0, w.z).multiply(new THREE.Matrix4().makeTranslation(0, 0, -w.off));
      put(concrete, cutBox([-MAKE.wing.thick / 2, MAKE.wing.thick / 2], [w.bottom, w.top], [w.off - w.long / 2, w.off + w.long / 2]), (_x, y, _z, n) => (n.y > 0.5 ? mix(grey(0.82), MOSS, 0.35) : mix(grey(0.98), DAMP, 0.5 * rnd(w.off, 55 + i) * (1 - smooth(0, 1.2, w.top - y)))), false, move);
    }
    SIDES.forEach((sx, q) => {
      // the footway, run down into the bank: a box whose top is sloped
      const far = zt(-MAKE.rail.onto), yf = e.walk[q], low = Math.min(yf, 0) - 0.8;
      const wedge = cutBox(span(sx, R2, half + F.out), [0, 1], [Math.min(e.z, far), Math.max(e.z, far)]), p = wedge.getAttribute('position');
      for (let v = 0; v < p.count; v++) p.setY(v, p.getY(v) < 0.5 ? low : K + ((yf - K) * Math.abs(p.getZ(v) - e.z)) / MAKE.rail.onto);
      wedge.computeVertexNormals();
      put(concrete, wedge, (_x, y) => grey(y > low + 0.1 ? 0.92 : 0.8));
      // and the block the railing ends at
      const zc = zt(-(MAKE.rail.onto + 0.2)), xc = sx * (half - MAKE.rail.inset);
      put(concrete, cutBox([xc - 0.2, xc + 0.2], [low - 0.25, yf + BRIDGE.rail], [zc - 0.25, zc + 0.25]), (_x, y, _z, n) => (n.y > 0.5 ? mix(grey(0.85), MOSS, 0.3) : mix(grey(1.02), EARTH, 0.6 * (1 - smooth(0, 0.5, y - yf)))));
    });
  });

  // ---- the railing: posts, three rails, and where the car went through
  const RAILS = [[1, 0.05, 0.07], [0.64, 0.035, 0.05], [0.3, 0.035, 0.05]];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  /** paint with so much rust come through it; and of a post, more toward its foot (`foot`: how high that is), where the wet stands */
  const coat = (key: number, more = 0, foot?: number): Tone => {
    const c = mix(PAINT, RUSTED, Math.min(1, 0.12 + 0.55 * rnd(key, 60) ** 2 + more));
    return foot === undefined ? () => c : (_x, y) => mix(c, RUSTED, 0.6 * (1 - smooth(0, 0.9, y - foot)));
  };
  SIDES.forEach((sx, q) => {
    const x = sx * (half - MAKE.rail.inset), N = 3, [ea, eb] = P.ends;
    interface Post { foot: THREE.Vector3; head: THREE.Vector3; bent: boolean }
    const stand = (z: number, y: number, outward = 0, on = 0): Post => {
      const foot = V(x, y, z);
      return { foot, head: foot.clone().addScaledVector(V(sx * Math.sin(outward), Math.cos(outward), Math.sin(on)).normalize(), BRIDGE.rail), bent: outward !== 0 || on !== 0 };
    };
    // in order along the bridge: down the first bank's footway, along the deck, down the second bank's
    const line: (Post | null)[] = [];
    for (let j = N; j >= 1; j--) line.push(stand((-MAKE.rail.onto * j) / N, K + ((ea.walk[q] - K) * j) / N));
    for (let k = 0; k <= P.bays; k++) line.push(P.gone(sx, k) ? null : stand(k * P.bay, K, ...P.lean(sx, k)));
    for (let j = 1; j <= N; j++) line.push(stand(len + (MAKE.rail.onto * j) / N, K + ((eb.walk[q] - K) * j) / N));
    line.forEach((p, k) => {
      if (p) put(steel, strut(p.foot, p.head, 0.07, 0.07), coat(k + sx * 100, p.bent ? 0.35 : 0, p.foot.y), true);
    });
    const on = (p: Post, up: number) => p.foot.clone().lerp(p.head, up);
    // The rails. One bar for as far as the posts stand straight in one line (a bar for every bay would be two
    // hundred boxes and more); where a post is bent, the bars to it go to where its head now is.
    const turn = (k: number) => k === N || k === N + P.bays;
    for (let k = 0; k < line.length - 1; ) {
      const a = line[k];
      let j = k + 1;
      if (!a || !line[j]) {
        k++;
        continue;
      }
      while (j < line.length - 1 && line[j + 1] && !a.bent && !line[j]!.bent && !line[j + 1]!.bent && !turn(j)) j++;
      const c = line[j]!;
      RAILS.forEach(([up, w, d], r) => put(steel, strut(on(a, up), on(c, up), w, d), coat(k * 7 + r + sx * 300, a.bent || c.bent ? 0.3 : 0), true));
      k = j;
    }
    if (P.gap && sx === P.gap.side) {
      // What is left in the hole: a rail still on the post it was bolted to, hanging into the cleft, and the stubs
      // of two more, bent the way the car went.
      const a = line[N + P.gap.from]!, c = line[N + P.gap.to]!, bare: Tone = (_x, y) => mix(BARE, RUSTED, 0.25 + 0.5 * rnd(y, 61));
      put(steel, strut(on(a, 0.64), on(a, 0.64).add(V(sx * 0.55, -2.35, 0.95)), 0.035, 0.05), bare, true);
      put(steel, strut(on(a, 1), on(a, 1).add(V(sx * 0.5, -0.15, 0.9)), 0.05, 0.07), bare, true);
      put(steel, strut(on(c, 1), on(c, 1).add(V(sx * 0.75, -0.3, -1.25)), 0.05, 0.07), bare, true);
    }
  });
  // ---- the joints: a steel strip across the deck over each bearing, where one span's end moves against the next's
  for (const z of [0.07, ...P.piers.map((p) => p.z), len - 0.07]) {
    put(steel, cutBox([-R2, R2], [-0.03, 0.012], [z - 0.06, z + 0.06]), () => DARK, true);
    for (const sx of SIDES) put(steel, cutBox(span(sx, R2 + K, half - F.in), [K - 0.03, K + 0.006], [z - 0.05, z + 0.05]), () => DARK, true);
  }

  // ---- the asphalt. In squares, each with corners of its own, so that a patch has an edge: the road's own
  // picture, a little darker than the road, with the gutters dirty and the wheels' two paths in each lane worn pale;
  // squares let into it where it has been mended; a band of tar either side of every joint; and down the middle
  // what forty years have left of a white line.
  const tar = { pos: [] as number[], uv: [] as number[], col: [] as number[] };
  const square = (x0: number, x1: number, z0: number, z1: number, yAt: (x: number, z: number) => number, tone: (x: number, z: number) => number) => {
    // (two triangles, each wound so that it faces up: x0 < x1 and z0 < z1)
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) {
      const v = tone(x, z);
      tar.pos.push(x, yAt(x, z), z);
      tar.uv.push(x / MAKE.road, z / MAKE.road);
      tar.col.push(v, v, v);
    }
  };
  // (it runs a little way in under the foot of each kerb)
  const edge = R2 + 0.04, path = [R2 / 2 - 0.75, R2 / 2 + 0.75], xs = [-edge, -path[1], -path[0], -0.07, 0.07, path[0], path[1], edge];
  const worn = (x: number) => (Math.abs(x) > R2 ? 0.72 : Math.abs(x) > 0.5 ? 1.03 : 0.95);
  const seals = [0, ...P.piers.map((p) => p.z), len], rows = [0, len];
  for (let k = 1, n = Math.max(1, Math.round(len / 1.5)); k < n; k++) rows.push((len * k) / n);
  for (const s of seals) rows.push(s - 0.4, s + 0.4);
  const zs = tidy(rows.filter((z) => z >= 0 && z <= len), 0.2);
  // where it has been mended: [from, to] across, [from, to] along, and how much darker (or paler: an old one) than the rest
  const mends: [number, number, number, number, number][] = [[path[0], path[1], len * 0.52, len * 0.93, 0.8]];
  for (let k = 0; k < 6; k++) {
    const pick = rnd(k, 73), across = pick < 0.4 ? [0.07, edge] : pick < 0.7 ? [path[0], edge] : [0.07, path[1]];
    const z0 = len * (0.06 + 0.86 * rnd(k, 71)), [x0, x1] = rnd(k, 70) < 0.5 ? across : [-across[1], -across[0]];
    mends.push([x0, x1, z0, z0 + 2.5 + 5 * rnd(k, 72), rnd(k, 74) < 0.7 ? 0.78 + 0.08 * rnd(k, 75) : 1.14]);
  }
  for (let c = 0; c < xs.length - 1; c++) {
    for (let r = 0; r < zs.length - 1; r++) {
      const xm = (xs[c] + xs[c + 1]) / 2, zm = (zs[r] + zs[r + 1]) / 2;
      let k = 0.84 + 0.06 * rnd(c, r);
      for (const [x0, x1, z0, z1, dark] of mends) if (xm > x0 && xm < x1 && zm > z0 && zm < z1) k *= dark;
      const dash = Math.floor(zm / 3);
      if (Math.abs(xm) < 0.07 && dash % 3 === 0) k = 1.15 + 0.95 * rnd(dash, 80);
      if (seals.some((s) => Math.abs(zm - s) < 0.4)) k = 0.58;
      square(xs[c], xs[c + 1], zs[r], zs[r + 1], () => 0, (x) => k * worn(x));
    }
  }
  // And off each end of the deck, down onto the road: the road lies a hand's breadth over the ground and the deck
  // a hand's breadth over that, so the asphalt is carried from the one to the other (as the wedge that stops a
  // wheel is: see `bridgeBoxes`), paling to the road's own colour as it goes.
  for (const e of P.ends) {
    const long = MAKE.ramp + 0.5, cuts = [0, 1, 2, 3, 4].map((k) => e.z - (e.into * long * k) / 4).sort(asc);
    const yAt = (x: number, z: number) => {
      const t = Math.min(1, Math.abs(z - e.z) / long);
      return t < 1e-6 ? 0 : P.ground(x, z) + 0.06 * t - P.ground(x, e.z) * (1 - t);
    };
    for (let c = 0; c < xs.length - 1; c++) {
      for (let r = 0; r < cuts.length - 1; r++) square(xs[c], xs[c + 1], cuts[r], cuts[r + 1], yAt, (x, z) => (0.86 + (0.14 * Math.abs(z - e.z)) / long) * worn(x));
    }
  }
  const asphalt = new THREE.BufferGeometry();
  asphalt.setAttribute('position', new THREE.Float32BufferAttribute(tar.pos, 3));
  asphalt.setAttribute('uv', new THREE.Float32BufferAttribute(tar.uv, 2));
  asphalt.setAttribute('color', new THREE.Float32BufferAttribute(tar.col, 3));
  asphalt.computeVertexNormals();

  return { concrete, asphalt: [asphalt], steel };
}

/**
 * The bridges of the map: drawn, and made solid.
 *
 * Each is three things to draw, one for each stuff it is made of, and nothing of it is worked out again once it
 * stands. (The asphalt throws no shadow of its own: it lies on the slab, which throws the same one, and whatever
 * throws a shadow is drawn again into each of the sun's shadow maps.)
 */
export function buildBridges(world: World, atmo: Atmosphere, scene: THREE.Scene): void {
  if (!world.bridges.length) return;
  const stone = assets.pbr('dirty_concrete'), road = assets.pbr('asphalt_02');
  const paints = {
    concrete: new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normalMap, roughnessMap: stone.armMap, aoMap: stone.armMap, roughness: 1, metalness: 0, vertexColors: true }),
    // (the road's own asphalt, and held toward the eye as the road's is: where it comes down onto the road at each end, the two are a finger apart)
    asphalt: new THREE.MeshStandardMaterial({ map: road.map, normalMap: road.normalMap, roughnessMap: road.armMap, aoMap: road.armMap, roughness: 1, metalness: 0, color: 0xd8d4cc, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    steel: new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.4, vertexColors: true }),
  };
  for (const m of Object.values(paints)) atmo.register(m);
  const groundAt = (x: number, z: number) => heightAt(world.heights, x, z);
  for (const b of world.bridges) {
    const P = planOf(b, groundAt), made = shapes(P, b.ax * 0.37 + b.az * 0.11);
    // out of the bridge's own measure into the world's: left, up and along, with the deck's climb as a lean of
    // what is along (so that what was made upright stands upright on a deck that climbs)
    const frame = new THREE.Matrix4().set(P.uz, 0, P.ux, b.ax, 0, 1, P.slope, b.ay, -P.ux, 0, P.uz, b.az, 0, 0, 0, 1);
    for (const stuff of ['concrete', 'asphalt', 'steel'] as const) {
      const geo = mergeGeometries(made[stuff], false);
      if (!geo) continue;
      geo.applyMatrix4(frame);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, paints[stuff]);
      mesh.name = `bridge:${stuff}`;
      mesh.castShadow = stuff !== 'asphalt';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
    if (!physics.world) continue; // planning only (server): no collision world
    for (const c of bridgeBoxes(b, groundAt)) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw);
      if (c.tilt) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), c.tilt));
      physics.addStaticQuat(physics.R.ColliderDesc.cuboid(c.hx, c.hy, c.hz), c.surface, { x: c.x, y: c.y, z: c.z }, q);
    }
  }
}
