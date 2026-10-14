// The ruined gatehouse at the end of the mountain road (MOUNTAIN in src/world/worldgen.ts; 2026-10-13: "for the
// castle I'd build a mountain road to a ruined gatehouse under it"): what is drawn of it, and what of it stops a
// body. It is the way to the fort on the brow above, and is made to the same words as the fort was ("too perfect
// ... more abstract geometry and more character ... ruins-ey"): rubble stone, roofless, broken, and not a building
// that is a box.
//
// WHAT STANDS THERE, coming in by the road:
//   - the gateway: two masses of masonry either side of the road. The left one stands, with the springing of the
//     arch that went over the road still leaning out of it; the right one is broken off under three metres, and
//     its top lies beside it. A beam that was over the gate lies across the two, its right end fallen with the
//     wall it sat on;
//   - the guardroom, behind the left mass: a roofless shell, one corner standing high with a window that looks
//     down the road, a doorway to the yard, a hearth, and the wall at its far end fallen outward as a slope of stone;
//   - the yard: low stubs of wall along its downhill edge and across its far end, with a way out in the far left
//     corner (three steps up, for the path to the fort); heaps where the walls came down, and a few big pieces of
//     fallen wall to get behind;
//   - before the gate: what is left of two low walls either side of the way in.
//
// HOW IT IS MADE. All of it is blocks: a list of them, worked out once, in the place's own measure, with no drawing
// and no physics in it (`plan`). No two are quite in line: each is moved and turned a little by a row of numbers
// that is the same every time, so the same place has the same ruin. A wall is told off in lengths, each of its own
// height, with a slant of broken wall from one down to the next, and that is its broken top. What stops a body is
// in the same list, as boxes (`gatehouseBoxes`).
//
// WHAT IT ASKS OF THE GROUND: nothing but that the yard is level. Everything that stands is founded under the yard;
// no height of the world is read here.
//
// WHAT IT COSTS: two things to draw (all the stone as one shape of some 3600 triangles, the timber as another),
// made once and never touched again, and some 140 boxes that never move. And one set of stone pictures, the
// fort's own: but asked for when the world is made, where the fort asks for its own only when somebody is near.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import type { Atmosphere, ShaderPatch } from './atmosphere';
import { SNOW_LIES, SNOW_PAINT, snowUniforms } from './foliage';

/**
 * Where it stands: the end of the road (the middle of it, on its surface) and the way the road was running there,
 * about Y as three turns a thing: at 0 the road runs toward +z.
 *
 * Everything in this file is in the place's own measure: the road's end at 0, 0, 0; +z on into the yard; and +x to
 * the LEFT of somebody coming in. (That is three's own handedness, not a choice: turned to look along +z, +x is on
 * the left hand.) On the mountain the left is uphill, the east.
 */
export interface GatePlace { x: number; y: number; z: number; rot: number }

type V3 = [number, number, number];
type Surface = 'rock' | 'wood' | 'metal';
/** what a block is of: a wall's face, the heart of a wall where it has broken open, fallen stone, timber */
type Stuff = 'wall' | 'core' | 'rubble' | 'timber';
/**
 * A block, in the place's own measure: its middle, half its size along its own three ways, and how it is turned:
 * about Y (`yaw`), then leaned about its own z (`lean`), then tipped about its own x (`tip`).
 *   tone   – how light it is beside the rest of its stuff
 *   open   – its underside is in the ground or in the block under it, and is not drawn
 *   cap    – its top is where a wall broke: the wall's heart, darker than its face
 *   loose  – it lies as it fell: the picture is laid on it from a place of its own, not carried on from its neighbour
 */
interface Block { stuff: Stuff; c: V3; h: V3; yaw: number; lean: number; tip: number; tone: number; open: boolean; cap: boolean; loose: boolean }
/** what stops a body: a level box, turned about Y only */
interface Solid { name: string; c: V3; h: V3; yaw: number; surface: Surface }

/** the road it stands across: how wide (MOUNTAIN.wide), and how far under the road's surface the yard was levelled */
const ROAD = 5.5, DROP = 0.08;
/** how far under the yard everything that stands is founded: so that nothing floats, whatever the ground does by a hand's breadth */
const FOOT = 0.6;
/**
 * Which side the mountain is on: 1, the left of somebody coming in (the place's +x), as the road has it. At -1 the
 * whole of it is built the other way round, the guardroom and the way out on the right.
 */
const UPHILL = 1 as 1 | -1;
/** metres to one turn of each picture: the fort's own (STUFF in src/world/castle-shape.ts), so a stone here is the size of a stone there */
const TILE = { stone: 2.6, timber: 1.6 };
/** each stuff's own lightness. (Timber's picture is near black as it comes: the fort raises it as far.) */
const TINT: Record<Stuff, number> = { wall: 1, core: 0.62, rubble: 0.78, timber: 1.5 };
/**
 * What is done to each set of stone pictures to make it this stone: the fort's own figures (PICTURES in
 * src/world/castle-shape.ts, and `aged` in src/world/castle.ts for what each does), copied here so that the gate
 * and the fort are one stone. A set with no line here is used as it comes.
 */
const GRADE: Record<string, { keep: number; lift: number; own: V3; even: number; stones: [number, number] }> = {
  castle_wall_slates: { keep: 0.75, lift: 1.12, own: [0.4, 0.385, 0.35], even: 0.18, stones: [7, 30] },
  defense_wall: { keep: 0.8, lift: 1.5, own: [0.3, 0.3, 0.28], even: 0.12, stones: [0, 0] },
};
/** the sets of stone pictures it may be drawn with, the first that the game has */
const STONE = ['castle_wall_slates', 'defense_wall', 'concrete_block_wall_02'];

const hash = (i: number, j: number, s: number) => {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

let made: { blocks: Block[]; solids: Solid[] } | null = null;

/**
 * The whole ruin, block by block, and what of it stops a body. Worked out once: it is the same wherever it stands.
 * Heights said here are over the yard unless they are a block's own `c`.
 */
function plan(): { blocks: Block[]; solids: Solid[] } {
  if (made) return made;
  const blocks: Block[] = [], solids: Solid[] = [];
  let drawn = 0;
  /** the next of a row of numbers that is the same every time, between `lo` and `hi` */
  const rnd = (lo = 0, hi = 1) => lo + (hi - lo) * hash(++drawn, 7919, 13);
  /** the yard, in the place's own measure */
  const Y = -DROP;

  const block = (stuff: Stuff, c: V3, h: V3, o: Partial<Omit<Block, 'stuff' | 'c' | 'h'>> = {}) => void blocks.push({ stuff, c, h, yaw: 0, lean: 0, tip: 0, tone: 1, open: false, cap: false, loose: false, ...o });
  /** what stops a body: a level box between these lines on the plan, from `bottom` over the yard to `top` over it */
  const solid = (name: string, x0: number, x1: number, z0: number, z1: number, top: number, bottom = -FOOT, surface: Surface = 'rock') =>
    void solids.push({ name, c: [(x0 + x1) / 2, Y + (top + bottom) / 2, (z0 + z1) / 2], h: [Math.abs(x1 - x0) / 2, (top - bottom) / 2, Math.abs(z1 - z0) / 2], yaw: 0, surface });
  /**
   * Masonry standing where it was built: between these lines on the plan, from `bottom` (unsaid: its footing) to
   * `top`. A little out of true, as nothing here is ruled: `out` says how far, beside a wall's length (less for
   * what has to meet its neighbours closely).
   */
  const stand = (x0: number, x1: number, z0: number, z1: number, top: number, bottom = -FOOT, o: { cap?: boolean; tone?: number; out?: number } = {}) => {
    const out = o.out ?? 1;
    block('wall', [(x0 + x1) / 2 + rnd(-0.03, 0.03) * out, Y + (top + bottom) / 2, (z0 + z1) / 2 + rnd(-0.03, 0.03) * out], [Math.abs(x1 - x0) / 2, (top - bottom) / 2, Math.abs(z1 - z0) / 2], {
      yaw: rnd(-0.03, 0.03) * out,
      tone: o.tone ?? rnd(0.9, 1.08),
      open: bottom < 0.01,
      cap: o.cap ?? true,
    });
  };
  /** a loose stone left lying on a broken top, its underside `on` over the yard */
  const stone = (x: number, z: number, on: number, size = 1) => {
    const hx = rnd(0.13, 0.27) * size, hy = rnd(0.07, 0.15) * size, hz = rnd(0.12, 0.23) * size;
    block('core', [x, Y + on + hy - 0.04, z], [hx, hy, hz], { yaw: rnd(0, Math.PI), lean: rnd(-0.2, 0.2), tip: rnd(-0.2, 0.2), tone: rnd(0.85, 1.12), loose: true });
  };

  /**
   * A block whose top is a slope: from `a` to `b` (each a spot on the plan and a height over the yard), `half` wide
   * either side of that line and `deep` thick under it. For the slant a wall breaks along: blocks standing square
   * to one another break in a stair, and a stair is too tidy.
   */
  const ramp = (a: V3, b: V3, half: number, deep: number, o: Partial<Omit<Block, 'stuff' | 'c' | 'h'>> = {}) => {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], long = Math.hypot(d[0], d[1], d[2]);
    const yaw = Math.atan2(-d[2], d[0]), lean = Math.asin(d[1] / long);
    // (the way its top faces: the block lies half its depth back from the line, that way)
    const n: V3 = [-Math.sin(lean) * Math.cos(yaw), Math.cos(lean), Math.sin(lean) * Math.sin(yaw)];
    block('wall', [(a[0] + b[0]) / 2 - (n[0] * deep) / 2, Y + (a[1] + b[1]) / 2 - (n[1] * deep) / 2, (a[2] + b[2]) / 2 - (n[2] * deep) / 2], [long / 2, deep / 2, half], { yaw, lean, tone: rnd(0.9, 1.06), open: true, cap: true, loose: true, ...o });
  };

  /**
   * A wall, told off from one end in lengths: each [how long, how high], and 0 high is a gap. It runs along x or
   * along z, on `line`, from `from`, the way `dir` says.
   *
   * Each length is a block of its own height, a little out of line with the next, and that is the wall's broken
   * top. Where two neighbours differ by more than a foot, the break between them is mostly a slant and not a
   * step: a block with a sloping top lies from the edge of the higher down onto the lower (not where `sheer`
   * names the length before the break: a window's sides stay upright). A stone or two is left lying on most of them.
   *
   * What stops a body is one box to a length, and those are NOT out of line: a body slides along a wall whose
   * lengths are flush, whatever its stones do. (What is drawn of a length is a hand longer than it is at each end,
   * so that no daylight shows between two that are turned different ways.) A slant half a metre high or more
   * has a box of its own, half its height over half its run.
   */
  const wall = (name: string, along: 'x' | 'z', line: number, from: number, dir: 1 | -1, thick: number, lengths: [number, number][], o: { foot?: number; sheer?: number[] } = {}) => {
    const foot = o.foot ?? FOOT;
    /** from along and across the wall to the plan's own x and z: [x0, x1, z0, z1] */
    const span = (lo: number, hi: number, half: number, off = 0): [number, number, number, number] => (along === 'x' ? [lo, hi, line + off - half, line + off + half] : [line + off - half, line + off + half, lo, hi]);
    /** a spot so far along the wall and so high */
    const spot = (t: number, over: number, off: number): V3 => (along === 'x' ? [t, over, line + off] : [line + off, over, t]);
    let at = from;
    lengths.forEach(([len, high], k) => {
      const a = at, b = (at += dir * len);
      if (high <= 0) return;
      const lo = Math.min(a, b), hi = Math.max(a, b), tall = high + rnd(-0.03, 0.03);
      const [x0, x1, z0, z1] = span(lo - 0.04, hi + 0.04, thick / 2 + rnd(-0.03, 0.04), rnd(-0.035, 0.035));
      block('wall', [(x0 + x1) / 2, Y + (tall - foot) / 2, (z0 + z1) / 2], [(x1 - x0) / 2, (tall + foot) / 2, (z1 - z0) / 2], { yaw: rnd(-0.03, 0.03), tone: rnd(0.9, 1.08), open: true, cap: true });
      solid(`${name} ${k + 1}`, ...span(lo, hi, thick / 2), high, -foot);
      if (len >= 0.6) {
        for (let s = rnd() < 0.4 ? 0 : len > 1.3 && rnd() < 0.35 ? 2 : 1; s > 0; s--) {
          const t = (lo + hi) / 2 + rnd(-1, 1) * (len / 2 - 0.25), u = line + rnd(-1, 1) * (thick / 2 - 0.22);
          stone(along === 'x' ? t : u, along === 'x' ? u : t, tall);
        }
      }
      const next = lengths[k + 1], step = next ? next[1] - high : 0;
      if (next && next[1] > 0 && Math.abs(step) > 0.3 && !o.sheer?.includes(k) && rnd() < 0.85) {
        // (from the edge of the higher of the two, down onto the lower: `to` is the way that is, along the wall)
        const rise = Math.abs(step), low = Math.min(high, next[1]), to = step < 0 ? dir : -dir;
        const run = Math.min(Math.max(0.25, (step < 0 ? next[0] : len) - 0.15), rise * rnd(0.7, 1.3)), off = rnd(-0.02, 0.02);
        // (as deep as fills the corner under it, so that it is a broken wall and not a slab leaning on one)
        ramp(spot(b - to * 0.05, low + rise - 0.02, off), spot(b + to * run, low - 0.03, off), (thick / 2) * rnd(0.8, 0.97), (rise * run) / Math.hypot(rise, run) + 0.12);
        if (rise >= 0.5) solid(`${name} ${k + 1} break`, ...span(Math.min(b, b + (to * run) / 2), Math.max(b, b + (to * run) / 2), thick / 2), low + rise / 2, -foot);
      }
    });
  };

  /**
   * A heap of fallen stone: `count` blocks within `rx` and `rz` of a spot, the biggest (`big` metres) toward the
   * middle, each part in the ground and lying as it fell. Under a heap big enough to hide it is the packed stuff
   * of the heap, a low mound out of level. One box stops a body (`top` high: low enough to be walked over).
   */
  const heap = (name: string, cx: number, cz: number, rx: number, rz: number, count: number, big: number, top = 0.26) => {
    if (rx * rz >= 0.3) block('rubble', [cx, Y + top - 0.36, cz], [rx * 0.62, 0.3, rz * 0.62], { yaw: rnd(-0.5, 0.5), lean: rnd(-0.12, 0.12), tip: rnd(-0.12, 0.12), tone: 0.8, open: true, loose: true });
    for (let k = 0; k < count; k++) {
      const a = rnd(0, Math.PI * 2), d = k < 2 ? rnd(0, 0.35) : Math.sqrt(rnd(0.12, 1)), s = big * (1 - 0.45 * d);
      const hx = Math.max(0.15, s * rnd(0.3, 0.5)), hy = Math.max(0.1, s * rnd(0.16, 0.3)), hz = Math.max(0.15, s * rnd(0.25, 0.42));
      // (the first two ride on the rest; the others are part in the ground)
      const y = k < 2 ? top - 0.08 + hy * 0.6 : hy * rnd(-0.2, 0.6);
      block('rubble', [cx + Math.cos(a) * d * rx, Y + y, cz + Math.sin(a) * d * rz], [hx, hy, hz], { yaw: rnd(0, Math.PI), lean: rnd(-0.28, 0.28), tip: rnd(-0.28, 0.28), tone: rnd(0.82, 1.08), loose: true });
    }
    solid(name, cx - rx * 0.8, cx + rx * 0.8, cz - rz * 0.8, cz + rz * 0.8, top);
  };

  /**
   * A big piece of fallen wall, lying where it came down: waist high, something to get behind. It broke as it
   * landed: the piece itself, lying out of level; its end, lower, turned a little and still against it; a stone
   * of its heart on its back and another beside it. Two boxes stop a body, the piece's and its end's, each level
   * and turned as its block is.
   */
  const fallen = (name: string, cx: number, cz: number, sx: number, sy: number, sz: number, yaw: number, sunk: number) => {
    const lean = rnd(0.06, 0.2) * (rnd() < 0.5 ? 1 : -1);
    block('wall', [cx, Y + sy / 2 - sunk, cz], [sx / 2, sy / 2, sz / 2], { yaw, lean, tip: rnd(-0.1, 0.1), tone: rnd(0.84, 0.98), loose: true });
    solids.push({ name, c: [cx, Y + (sy - sunk - FOOT) / 2, cz], h: [sx / 2, (sy - sunk + FOOT) / 2, sz / 2], yaw, surface: 'rock' });
    const side = rnd() < 0.5 ? 1 : -1, ex = sx * rnd(0.42, 0.58), ey = sy * rnd(0.5, 0.75), ez = sz * rnd(0.7, 0.95);
    const turn = yaw + rnd(0.25, 0.55) * (rnd() < 0.5 ? 1 : -1), off = (sx / 2 + ex / 2 - 0.18) * side, deep = sunk + rnd(0.02, 0.1);
    const px = cx + Math.cos(yaw) * off, pz = cz - Math.sin(yaw) * off;
    block('wall', [px, Y + ey / 2 - deep, pz], [ex / 2, ey / 2, ez / 2], { yaw: turn, lean: -lean * rnd(0.5, 1.2), tip: rnd(-0.12, 0.12), tone: rnd(0.82, 0.98), loose: true });
    solids.push({ name: `${name} end`, c: [px, Y + (ey - deep - FOOT) / 2, pz], h: [ex / 2, (ey - deep + FOOT) / 2, ez / 2], yaw: turn, surface: 'rock' });
    block('core', [cx + rnd(-0.22, 0.22) * sx, Y + sy - sunk + 0.08, cz + rnd(-0.18, 0.18) * sz], [rnd(0.2, 0.32), rnd(0.1, 0.16), rnd(0.18, 0.28)], { yaw: yaw + rnd(-0.6, 0.6), lean: rnd(-0.25, 0.25), tip: rnd(-0.25, 0.25), tone: rnd(0.9, 1.1), loose: true });
    const by = (sx / 2 + rnd(0.25, 0.4)) * -side;
    block('rubble', [cx + Math.cos(yaw) * by, Y + 0.06, cz - Math.sin(yaw) * by], [rnd(0.22, 0.34), rnd(0.14, 0.2), rnd(0.2, 0.3)], { yaw: yaw + rnd(-0.8, 0.8), lean: rnd(-0.25, 0.25), tip: rnd(-0.25, 0.25), tone: rnd(0.85, 1.05), loose: true });
  };

  // ------------------------------------------------------------------ the gateway
  //
  // The two masses stand a pace clear of the asphalt on either side: nothing of the gate is in the road's width
  // under the height of a lorry. Each is `G0`..`G1` thick along the road and `IN`..`OUT` from its middle.
  const IN = ROAD / 2 + 0.1, OUT = IN + 3.2, G0 = 0.9, G1 = 3.1;

  // The left mass: it stands. A footing course a little proud of it; two lifts of wall, the upper one set in from
  // the lower and not quite square on it (it has shifted: there is a ledge round it for the snow); and a top
  // broken in five pieces of five heights, highest over the road, with a slant of broken wall from each height
  // down to the next. Where the curtain was torn from its outer face, two of the curtain's stones still stand out of it.
  stand(IN - 0.06, OUT + 0.06, G0 - 0.06, G1 + 0.06, 0.55, -FOOT, { cap: false, tone: 0.9, out: 0.3 });
  stand(IN, OUT, G0, G1, 2.7, 0.5, { cap: false, out: 0.4 });
  stand(IN + 0.05, OUT - 0.07, G0 + 0.06, G1 - 0.05, 4.15, 2.65, { cap: false, out: 0.7 });
  const HEAD = { road: 5.5, back: 5.12, mid: 4.9, far: 4.5, low: 4.22 };
  stand(IN + 0.04, 3.98, G0 + 0.05, 2.08, HEAD.road, 4.1, { out: 0.4 });
  stand(IN + 0.06, 3.98, 2.02, G1 - 0.06, HEAD.back, 4.1, { out: 0.4 });
  stand(3.92, 5.03, G0 + 0.08, G1 - 0.07, HEAD.mid, 4.1, { out: 0.4 });
  stand(4.97, OUT - 0.09, G0 + 0.06, 2.23, HEAD.far, 4.1, { out: 0.4 });
  stand(4.97, OUT - 0.1, 2.17, G1 - 0.08, HEAD.low, 4.1, { out: 0.4 });
  ramp([3.55, HEAD.road - 0.02, 1.47], [4.6, HEAD.mid + 0.02, 1.47], 0.48, 0.45);
  ramp([4.75, HEAD.mid - 0.02, 2.55], [5.75, HEAD.low + 0.03, 2.55], 0.44, 0.5);
  stone(3.35, 1.5, HEAD.road, 1.2);
  stone(4.5, 2.5, HEAD.mid, 1.3);
  stone(5.5, 1.5, HEAD.far, 1.2);
  block('wall', [OUT + 0.1, Y + 3.42, 1.9], [0.2, 0.1, 0.22], { yaw: 0.05, tone: 1.02, loose: true });
  block('wall', [OUT + 0.06, Y + 3.9, 2.15], [0.17, 0.09, 0.2], { yaw: -0.08, tone: 0.96, loose: true });
  solid('gate mass left', IN, OUT, G0, G1, HEAD.low);
  solid('gate mass left top', IN, 5.0, G0, G1, HEAD.mid);
  solid('gate mass left head', IN, 3.95, G0, G1, HEAD.road);

  // The springing of the arch. It was a round arch over the road, struck from the middle of the road at `SPRING`:
  // an impost course at its foot, round the corner of the mass and broken off along its front; and the first five
  // of its stones still in the wall, each leaning further out over the road than the one under it, the last of
  // them broken; then nothing. They are the front order of the arch only (the beam lies behind them), and stand
  // a hand proud of the mass's face, so that the line of them is seen from the road. Nothing of it is lower than
  // a lorry is tall.
  const SPRING = 2.95, RING = { inner: IN - 0.06, deep: 0.5, z0: G0 - 0.1, z1: 2.15, turn: (10.5 * Math.PI) / 180 };
  block('wall', [IN + 0.06, Y + SPRING - 0.11, (RING.z0 + RING.z1 + 0.05) / 2], [0.19, 0.11, (RING.z1 + 0.05 - RING.z0) / 2], { tone: 1.1, yaw: 0.01 });
  block('wall', [IN + 0.9, Y + SPRING - 0.115, G0], [1.03, 0.105, 0.1], { tone: 1.08, yaw: -0.006 });
  for (let k = 0; k < 5; k++) {
    const broken = k === 4, at = (broken ? k + 0.35 : k + 0.5) * RING.turn + rnd(-0.012, 0.012), r = RING.inner + RING.deep / 2 + rnd(-0.02, 0.02);
    block('wall', [r * Math.cos(at), Y + SPRING + r * Math.sin(at), (RING.z0 + RING.z1) / 2 + rnd(-0.03, 0.03)], [(RING.deep / 2) * rnd(0.92, 1.05), ((r * RING.turn) / 2) * (broken ? 0.7 : 0.97), ((RING.z1 - RING.z0) / 2) * rnd(0.95, 1)], { lean: at, tone: rnd(1.02, 1.14), loose: true });
  }
  // (what is left of the wall that stood on the arch: one stone on its back)
  block('core', [IN - 0.23, Y + 5.1, 1.5], [0.24, 0.2, 0.48], { lean: 0.35, yaw: 0.06, tone: 1.1, loose: true });
  solid('arch springing', IN - 0.6, IN, RING.z0, RING.z1, 5.13, 3.6);
  solid('arch springing end', IN - 1.05, IN - 0.4, RING.z0, RING.z1, 5.45, 4.8);

  // The right mass: broken off, in three heights down from the road outward (the way its top went), with a slant
  // of broken wall from each down to the next.
  const STUMP = { road: 2.8, mid: 2.3, low: 1.8 };
  stand(-OUT - 0.06, -IN + 0.06, G0 - 0.06, G1 + 0.06, 0.55, -FOOT, { cap: false, tone: 0.9, out: 0.3 });
  stand(-OUT, -IN, G0, G1, STUMP.low, 0.5, { out: 0.4 });
  stand(-3.93, -IN - 0.02, G0 + 0.03, G1 - 0.03, STUMP.road, 1.75, { out: 0.4 });
  stand(-5.02, -3.87, G0 + 0.05, G1 - 0.02, STUMP.mid, 1.75, { out: 0.4 });
  ramp([-3.6, STUMP.road - 0.02, 2.5], [-4.6, STUMP.mid + 0.02, 2.5], 0.5, 0.4);
  ramp([-4.75, STUMP.mid - 0.02, 1.55], [-5.8, STUMP.low + 0.03, 1.55], 0.52, 0.4);
  stone(-4.5, 1.5, STUMP.mid, 1.3);
  stone(-5.5, 2.5, STUMP.low, 1.4);
  solid('gate mass right', -OUT, -IN, G0, G1, STUMP.low);
  solid('gate mass right step', -5.0, -IN, G0, G1, STUMP.mid);
  solid('gate mass right head', -3.9, -IN, G0, G1, STUMP.road);

  // The beam. It lay level over the gate, behind the arch; its right end came down with the wall it sat on. Now
  // that end is on the stump and the beam leans up from there to the left mass, rests on the edge of the mass's
  // back top, and stands on a little way over it. It is given by where its right end is and where it bears on that
  // edge. A body is stopped by five level boxes that step up along it: a box here is turned about Y and no other way.
  {
    const end: V3 = [-IN - 0.55, STUMP.road + 0.16, 1.72], bears: V3 = [IN + 0.02, HEAD.back + 0.16, 2.62], over = 0.9, half: V3 = [0, 0.15, 0.14];
    const d: V3 = [bears[0] - end[0], bears[1] - end[1], bears[2] - end[2]], run = Math.hypot(d[0], d[1], d[2]), long = run + over;
    const u: V3 = [d[0] / run, d[1] / run, d[2] / run], yaw = Math.atan2(-u[2], u[0]), lean = Math.asin(u[1]);
    block('timber', [end[0] + (u[0] * long) / 2, Y + end[1] + (u[1] * long) / 2, end[2] + (u[2] * long) / 2], [long / 2, half[1], half[2]], { yaw, lean, tip: 0.1, tone: 1 });
    const N = 5;
    for (let k = 0; k < N; k++) {
      const t = ((k + 0.5) / N) * long;
      solids.push({ name: `beam ${k + 1}`, c: [end[0] + u[0] * t, Y + end[1] + u[1] * t, end[2] + u[2] * t], h: [(long / N / 2) * Math.cos(lean), half[1] + (long / N / 2) * Math.sin(lean) * 0.5, half[2]], yaw, surface: 'wood' });
    }
  }

  // The top of the right mass, where it fell: three big pieces behind what is left of the curtain, and the small
  // stuff about them. And the stones of the arch, which came down in the road and were rolled out of it to the side.
  fallen('fallen gate top 1', -7.3, 4.6, 1.5, 1.0, 1.1, 0.35, 0.12);
  fallen('fallen gate top 2', -8.6, 6.0, 1.1, 0.75, 0.9, -0.6, 0.1);
  fallen('fallen gate top 3', -6.0, 6.7, 1.3, 0.7, 0.9, 1.1, 0.1);
  heap('gate rubble', -7.3, 3.4, 1.2, 0.6, 8, 0.9);
  heap('arch stones', -4.2, 4.9, 0.75, 1.0, 7, 0.8);
  heap('gate rubble left', 3.75, 3.75, 0.45, 0.4, 6, 0.6);

  // What is left of the curtain to the right of the gate: a stub against the mass, a breach, and the corner.
  wall('curtain right', 'x', 2.0, -5.9, -1, 0.8, [[1.15, 1.55], [0.75, 0.75], [0.35, 0.3], [1.0, 0], [0.35, 0.45]]);
  heap('curtain breach', -8.65, 2.0, 0.45, 0.7, 6, 0.7);

  // Before the gate: two low walls either side of the way in, mostly gone. (They are founded deeper: the ground
  // out here is the road's shoulder and not the yard.)
  wall('approach left', 'z', 4.7, 1.05, -1, 0.7, [[1.45, 1.35], [1.1, 0.75], [0.4, 0.35], [1.5, 0], [0.9, 0.55]], { foot: 1 });
  wall('approach right', 'z', -4.7, 1.05, -1, 0.7, [[1.25, 0.85], [0.4, 0.4], [1.9, 0], [1.0, 0.5]], { foot: 1.2 });

  // ------------------------------------------------------------------ the guardroom
  //
  // Seven metres by five and a half, behind the left mass and against the hill. Its front wall is the curtain on
  // that side of the gate, and the mass is its near corner.
  const ROOM = { x0: 4.5, x1: 10, z0: 1.6, z1: 8.6, wall: 0.8 };
  // The front wall, and the corner that stands highest (a chimney is the last thing of a house to fall). The
  // window looks down the road: a length a sill high between two that stand, a stone over it, and a little wall
  // still on the stone.
  const WINDOW = { x0: 7.1, x1: 7.9, sill: 1.15, head: 2.35 };
  wall('guardroom front', 'x', ROOM.z0 + ROOM.wall / 2, OUT - 0.15, 1, ROOM.wall, [[WINDOW.x0 - OUT + 0.15, 3.1], [WINDOW.x1 - WINDOW.x0, WINDOW.sill], [1.05, 3.45], [ROOM.x1 - WINDOW.x1 - 1.05, 3.8]], { sheer: [0, 1] });
  block('wall', [(WINDOW.x0 + WINDOW.x1) / 2 + 0.02, Y + WINDOW.head + 0.135, ROOM.z0 + ROOM.wall / 2], [0.65, 0.135, ROOM.wall / 2 + 0.05], { tone: 1.12, yaw: 0.012 });
  block('wall', [(WINDOW.x0 + WINDOW.x1) / 2, Y + WINDOW.head + 0.46, ROOM.z0 + ROOM.wall / 2 + 0.01], [0.45, 0.2, ROOM.wall / 2 - 0.03], { tone: 0.97, yaw: -0.02, cap: true });
  stone(7.4, 2.0, WINDOW.head + 0.66, 0.9);
  solid('window head', WINDOW.x0, WINDOW.x1, ROOM.z0, ROOM.z0 + ROOM.wall, WINDOW.head + 0.66, WINDOW.head);
  // The wall against the hill: down from the high corner, not evenly.
  wall('guardroom hill wall', 'z', ROOM.x1 - ROOM.wall / 2, ROOM.z0 + ROOM.wall, 1, ROOM.wall, [[1.1, 3.65], [1.1, 3.2], [0.9, 2.3], [1.1, 1.6], [1.1, 2.0], [0.9, 1.0]]);
  // The wall at its far end fell outward, all of it: its foot is left, low enough to step over in the middle, and
  // the rest is a slope of stone out into the yard, with what fell inward at the foot of it inside.
  wall('guardroom far wall', 'x', ROOM.z1 - ROOM.wall / 2, ROOM.x1 - ROOM.wall, -1, ROOM.wall, [[1.2, 0.75], [1.1, 0.5], [1.0, 0.62], [0.6, 0.5], [0.8, 0.85]]);
  for (let k = 0; k < 8; k++) {
    // (the packed stuff of the slope, in eight tongues, no two lying one way: four against the wall's foot and four below them)
    const upper = k < 4, x = 5.75 + (k % 4) * 1.12 + rnd(-0.15, 0.15);
    if (upper) block('rubble', [x, Y + 0.14 + rnd(-0.05, 0.05), 9.3 + rnd(-0.1, 0.1)], [rnd(0.6, 0.8), 0.36, rnd(0.8, 0.95)], { yaw: rnd(-0.35, 0.35), lean: rnd(-0.07, 0.07), tip: rnd(0.05, 0.14), tone: rnd(0.76, 0.86), open: true, loose: true });
    else block('rubble', [x + 0.3, Y - 0.08 + rnd(-0.04, 0.04), 10.7 + rnd(-0.12, 0.12)], [rnd(0.55, 0.75), 0.3, rnd(0.7, 0.85)], { yaw: rnd(-0.4, 0.4), lean: rnd(-0.08, 0.08), tip: rnd(0.14, 0.26), tone: rnd(0.74, 0.84), open: true, loose: true });
  }
  for (let k = 0; k < 13; k++) {
    // (and on it, slabs of the wall's face, lying the way they went over: eight on the upper part of the slope and five at its foot)
    const upper = k < 8, x = rnd(5.3, 9.4), z = upper ? rnd(8.75, 10) : rnd(10.1, 11.25), s = upper ? 1 : 0.75;
    block('rubble', [x, Y + (upper ? 0.52 - (z - 8.6) * 0.09 : 0.32 - (z - 10) * 0.2) + rnd(-0.03, 0.06), z], [rnd(0.3, 0.5) * s, rnd(0.1, 0.2) * s, rnd(0.24, 0.42) * s], { yaw: rnd(-0.6, 0.6), lean: rnd(-0.22, 0.22), tip: rnd(-0.05, 0.36), tone: rnd(0.84, 1.1), loose: true });
  }
  solid('guardroom fallen wall', 5.2, 9.5, ROOM.z1, 10.1, 0.5);
  solid('guardroom fallen wall foot', 5.3, 9.4, 10.1, 11.4, 0.24);
  heap('guardroom rubble', 7.3, 7.35, 1.5, 0.4, 6, 0.6);
  // The wall to the yard, with the doorway in it (1.1 m: a flat stone for its threshold, which stops nobody).
  wall('guardroom yard wall', 'z', ROOM.x0 + ROOM.wall / 2, G1 - 0.15, 1, ROOM.wall, [[1.05, 2.7], [0.9, 2.2], [1.1, 0], [0.9, 1.75], [0.9, 1.1]]);
  block('wall', [ROOM.x0 + ROOM.wall / 2, Y - 0.12, 5.45], [ROOM.wall / 2 + 0.07, 0.17, 0.57], { tone: 0.92, yaw: 0.02, open: true });
  // The hearth, in the high corner: a hearth stone, a cheek either side of the fire, the breast over it broken off
  // short, and a stub of the flue going up the corner.
  {
    const H = { x0: 8.3, x1: ROOM.x1 - ROOM.wall + 0.1, z0: ROOM.z0 + ROOM.wall - 0.1, z1: 3.9 };
    stand(H.x0 - 0.3, H.x1, H.z0, H.z1 + 0.15, 0.18, -FOOT, { cap: false, tone: 0.88, out: 0.5 });
    stand(H.x0, H.x1, H.z1 - 0.3, H.z1, 1.08, 0.1, { cap: false, out: 0.5 });
    stand(H.x0 + 0.05, H.x1, H.z0, H.z0 + 0.32, 1.08, 0.1, { cap: false, out: 0.5 });
    stand(H.x0 - 0.05, H.x1, H.z0, H.z1 + 0.04, 1.95, 1.05, { out: 0.5 });
    stand(H.x0 + 0.3, H.x1, H.z0, H.z1 - 0.5, 2.7, 1.9, { out: 0.5 });
    solid('hearth', H.x0, H.x1, H.z0, H.z1, 1.95);
    solid('hearth flue', H.x0 + 0.3, H.x1, H.z0, H.z1 - 0.5, 2.7);
  }
  // What is left of its roof: the ends of two joists in the wall against the hill, and a rafter lying on the slope
  // of the fallen wall. (None of them stops anything: the joists are over a head, and the rafter lies on the heap.)
  block('timber', [ROOM.x1 - ROOM.wall - 0.16, Y + 2.3, 4.25], [0.34, 0.09, 0.08], { yaw: 0.06, lean: 0.05, tone: 0.95 });
  block('timber', [ROOM.x1 - ROOM.wall - 0.1, Y + 2.12, 5.12], [0.3, 0.09, 0.08], { yaw: -0.1, lean: 0.16, tone: 0.9 });
  block('timber', [7.9, Y + 0.5, 9.75], [1.35, 0.08, 0.1], { yaw: -1.38, lean: -0.15, tip: 0.3, tone: 0.92 });

  // ------------------------------------------------------------------ the yard
  //
  // Its downhill edge: four runs of low wall and three gaps, the middle one a breach wide enough to come through.
  // (Founded deeper than the rest: the ground begins to fall away under its outer face.)
  wall('yard wall', 'z', -9.85, ROOM.z0, 1, 0.7, [
    [1.0, 1.25], [1.2, 0.9], [1.4, 1.45], [0.9, 0.7], [1.0, 1.1], [0.8, 0.55], [0.4, 0.28],
    [1.1, 0],
    [0.4, 0.35], [1.1, 0.8], [1.5, 1.5], [1.2, 1.6], [0.9, 1.05], [1.2, 0.6],
    [2.2, 0],
    [0.9, 0.5], [1.3, 1.2], [1.0, 0.85], [1.6, 1.4], [0.4, 0.5],
    [1.0, 0],
    [0.4, 0.4], [1.1, 0.95], [1.4, 1.3], [0.9, 0.6], [1.3, 1.1], [0.8, 1.55],
  ], { foot: 0.9 });
  heap('yard wall gap', -9.4, 8.85, 0.6, 0.6, 6, 0.7);
  heap('yard wall breach', -9.3, 16.8, 0.8, 1.0, 10, 0.9);
  heap('yard wall gap 2', -9.4, 23.6, 0.6, 0.5, 6, 0.7);
  // Its far end: three runs, and then the way out. The last length is the way out's own post, and nothing is built
  // between it and the hill: three metres and more, whatever the hill does.
  const WAY = { x0: 7.3, x1: 10.3 };
  wall('end wall', 'x', 29.65, -9.5, 1, 0.7, [
    [1.3, 1.35], [1.0, 0.8], [1.5, 1.15], [0.4, 0.4],
    [1.2, 0],
    [0.4, 0.3], [0.9, 0.6], [1.5, 1.3], [1.2, 1.6], [1.4, 1.0], [0.4, 0.45],
    [1.1, 0],
    [0.4, 0.35], [1.0, 0.7], [1.3, 1.2], [0.8, 0.9], [WAY.x0 - 6.3, 1.6],
  ]);
  heap('end wall gap', -4.7, 29.3, 0.55, 0.55, 6, 0.7);
  heap('end wall gap 2', 2.25, 29.3, 0.5, 0.55, 6, 0.7);
  heap('yard corner', -8.5, 28.2, 0.9, 0.8, 7, 0.8);
  // The steps to the way out: three risers of a hand and a half up to a landing in the line of the wall, where the
  // path to the fort begins. And two down again behind it, which are under the ground wherever the hill comes up
  // to the landing, and are there for wherever it does not.
  [[27.9, 28.6, 0.2], [28.6, 29.3, 0.4], [29.3, 30.3, 0.6], [30.3, 30.65, 0.4], [30.65, 30.97, 0.2]].forEach(([z0, z1, top], k) => {
    stand(WAY.x0 + 0.05 + rnd(0, 0.12), WAY.x1 - 0.1 - rnd(0, 0.12), z0 - (k < 3 ? 0 : 0.05), z1 + (k < 2 ? 0.05 : 0), top + rnd(-0.012, 0.012), -FOOT, { cap: false, tone: rnd(0.9, 1), out: 0.35 });
    solid(`way out step ${k + 1}`, WAY.x0 + 0.05, WAY.x1 - 0.1, z0, z1, top);
  });
  // Big pieces of fallen wall, here and there: none in the road's width for the first fourteen metres, and none on
  // the line a body walks from the gate to the way out.
  fallen('fallen wall 1', -5.4, 10.4, 2.0, 0.95, 0.8, 0.45, 0.1);
  fallen('fallen wall 2', -5.6, 18.6, 1.6, 1.05, 0.9, -0.7, 0.08);
  fallen('fallen wall 3', 2.0, 17.0, 1.3, 0.9, 1.0, 0.3, 0.12);
  fallen('fallen wall 4', -0.4, 22.6, 2.3, 1.0, 0.8, 1.35, 0.1);
  fallen('fallen wall 5', 4.6, 24.8, 1.7, 1.1, 0.9, -0.3, 0.1);

  // (built the other way round, if the mountain is on the right: a block mirrored is the same block, turned the other way)
  const turned = (c: V3): V3 => [c[0] * UPHILL, c[1], c[2]];
  return (made = {
    blocks: blocks.map((b) => ({ ...b, c: turned(b.c), yaw: b.yaw * UPHILL, lean: b.lean * UPHILL })),
    solids: solids.map((s) => ({ ...s, c: turned(s.c), yaw: s.yaw * UPHILL })),
  });
}

/** a spot of the place's own measure, in the world */
function inWorld(p: GatePlace, x: number, y: number, z: number): V3 {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [p.x + x * c + z * s, p.y + y, p.z - x * s + z * c];
}

/**
 * Everything of it that stops a body, a wheel and a shot, in the world: each box's middle, half its size each way,
 * and how it is turned about Y. No drawing and no physics is needed to ask.
 *
 * One box to each length of wall, each big fallen piece and each step; one to a heap (low: a heap is walked over);
 * the gate's masses as boxes one inside another, a taller for each step of their tops. Every one of them goes down
 * into the ground but those that something else carries: the beam, the springing of the arch, the head of the window.
 */
export function gatehouseBoxes(p: GatePlace): { name: string; x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number; surface: 'rock' | 'wood' | 'metal' }[] {
  return plan().solids.map((s) => {
    const [x, y, z] = inWorld(p, s.c[0], s.c[1], s.c[2]);
    return { name: s.name, x, y, z, hx: s.h[0], hy: s.h[1], hz: s.h[2], yaw: p.rot + s.yaw, surface: s.surface };
  });
}

/**
 * A block as a shape, where it stands in the world, with everything its paint needs said at each corner.
 *
 * THE PICTURE is laid on by the block's own three ways, in metres, so no face of it is stretched however the block
 * is turned; and from where the block is on the plan, so that the courses of a wall run on, level, from one length
 * into the next. (A block that lies as it fell starts from a place of its own.) Timber's grain runs along its length.
 *
 * ITS COLOUR at a corner is its stuff's tone and its own; darker toward the ground, where stone stays wet; and
 * darker on the top of a wall that broke there, which is the wall's heart and not its face.
 */
function shape(b: Block, k: number, to: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2);
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), uv = g.getAttribute('uv'), n = pos.count;
  const tile = b.stuff === 'timber' ? TILE.timber : TILE.stone, su = b.loose ? hash(k, 3, 71) : 0, sv = b.loose ? hash(k, 5, 71) : 0;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ax = Math.abs(nrm.getX(i)) > 0.5, ay = Math.abs(nrm.getY(i)) > 0.5;
    let u: number, v: number;
    if (b.stuff === 'timber') [u, v] = ax ? [z, y] : ay ? [z, x] : [y, x];
    else [u, v] = ay ? [b.c[0] + x, b.c[2] + z] : ax ? [b.c[2] + z, b.c[1] + y] : [b.c[0] + x, b.c[1] + y];
    uv.setXY(i, u / tile + su, v / tile + sv);
  }
  // (a box's faces come in the order +x, -x, +y, -y, +z, -z, four corners and two triangles to each)
  if (b.open) g.setIndex(Array.from(g.index!.array).filter((_, i) => i < 18 || i >= 24));
  g.clearGroups();
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(b.tip, b.yaw, b.lean, 'YZX')).setPosition(b.c[0], b.c[1], b.c[2]));
  const col = new Float32Array(n * 3), foot = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const over = pos.getY(i) + DROP, top = b.cap && i >= 8 && i < 12;
    const t = TINT[b.stuff] * b.tone * (top ? TINT.core : 1) * (b.stuff === 'timber' ? 1 : 0.8 + 0.2 * Math.min(1, Math.max(0, over / 1.2)));
    col.set([t, t, t], i * 3);
    foot[i] = over;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aFoot', new THREE.BufferAttribute(foot, 1));
  return g.applyMatrix4(to);
}

/**
 * What is done to the picture, in the shader: all of it colour, none of it moves a corner.
 *
 * THE STONE (`grade`): the picture made the fort's stone, and no two stones of it quite one tone, as the fort has
 * it (see `aged` in src/world/castle.ts). Rain has run down whatever stands upright, in dark streaks, more the
 * higher the wall.
 *
 * SNOW. It stands above the snow line, and snow lies on it where it lies on the ground beside it (`snowLies`, by
 * where in the world a point is): on what faces the sky, thinner in patches; and drifted against the foot of
 * whatever stands upright, a hand deep here and a forearm there. The stone is dark with melt where the snow ends.
 * Each corner says how high it is over the yard (`aFoot`), and that is all the drift goes by.
 */
const weathered = (grade: (typeof GRADE)[string] | undefined, stone: boolean): ShaderPatch => (shader) => {
  // (snow lies by place as well as by height: see src/world/snow.ts)
  Object.assign(shader.uniforms, snowUniforms);
  const f = (v: number) => v.toFixed(3);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aFoot;\nvarying vec3 vGateW;\nvarying vec3 vGateN;\nvarying float vGateFoot;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGateW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;\nvGateN = mat3( modelMatrix ) * normal;\nvGateFoot = aFoot;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vGateW;
varying vec3 vGateN;
varying float vGateFoot;${SNOW_LIES}
// (a number for each stone of the picture, with no sine in it: a sine of a big number is not the same on every card)
float gateCell( vec2 c ) { vec3 q = fract( vec3( c.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }`,
    )
    .replace(
      '#include <map_fragment>',
      grade
        ? `#include <map_fragment>
#ifdef USE_MAP
{
  float gateGrey = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
  diffuseColor.rgb = mix( mix( vec3( gateGrey ), diffuseColor.rgb, ${f(grade.keep)} ) * ${f(grade.lift)}, vec3( ${grade.own.map(f).join(', ')} ), ${f(grade.even)} );
  ${grade.stones[0] ? `diffuseColor.rgb *= 0.88 + 0.24 * gateCell( floor( vMapUv * vec2( ${f(grade.stones[0])}, ${f(grade.stones[1])} ) ) );` : ''}
}
#endif`
        : '#include <map_fragment>',
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
{
  vec3 gateN = normalize( vGateN );
  float gateUpright = 1.0 - smoothstep( 0.25, 0.6, abs( gateN.y ) );
  // slow patches, 0..1, of two sizes
  float gateBlot = 0.5 + 0.5 * sin( vGateW.x * 1.7 + sin( vGateW.z * 2.3 + vGateW.y * 0.9 ) * 1.3 ) * sin( vGateW.z * 1.9 + sin( vGateW.x * 1.3 + vGateW.y * 2.1 ) );
  ${stone ? `float gateWide = 0.5 + 0.5 * sin( vGateW.x * 0.53 + vGateW.y * 0.4 + sin( vGateW.z * 0.71 ) * 2.0 ) * sin( vGateW.z * 0.47 - vGateW.y * 0.3 + 1.7 );
  // rain down what stands upright, by where along the wall a place is
  float gateRun = dot( vGateW.xz, vec2( gateN.z, -gateN.x ) );
  float gateStreak = smoothstep( 0.5, 1.0, 0.5 + 0.5 * sin( gateRun * 5.3 + sin( gateRun * 1.7 ) * 3.0 ) ) * ( 0.35 + 0.65 * gateWide );
  diffuseColor.rgb *= 1.0 - 0.22 * gateStreak * gateUpright * smoothstep( 0.3, 1.6, vGateFoot );` : ''}
  float gateLies = snowLies( vGateW );
  if ( gateLies > 0.0 ) {
    // on what faces the sky, thinner in patches; and drifted against the foot of what stands
    float gateTop = smoothstep( 0.3, 0.7, gateN.y + ( gateBlot - 0.5 ) * 0.3 ) * ( 0.72 + 0.28 * smoothstep( 0.25, 0.6, gateBlot ) );
    float gateDrift = ( 1.0 - smoothstep( 0.0, 0.08 + 0.3 * gateBlot, vGateFoot ) ) * gateUpright;
    float gateLaid = gateLies * max( gateTop, gateDrift );
    // the stone is dark with melt where the snow ends
    diffuseColor.rgb *= 1.0 - 0.3 * smoothstep( 0.0, 0.2, gateLaid ) * ( 1.0 - smoothstep( 0.2, 0.75, gateLaid ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, ${SNOW_PAINT} * ( 0.93 + 0.07 * gateBlot ), gateLaid );
    roughnessFactor = mix( roughnessFactor, 0.65, gateLaid );
    metalnessFactor *= 1.0 - gateLaid;
  }
}`,
    );
};

/**
 * The gatehouse stood in the world: two things to draw (its stone, its timber), each one shape made here and never
 * touched again, and what stops a body (the boxes of `gatehouseBoxes`, where there is a world to stop one in).
 */
export function buildGatehouse(p: GatePlace, atmo: Atmosphere, scene: THREE.Scene): void {
  const to = new THREE.Matrix4().makeRotationY(p.rot).setPosition(p.x, p.y, p.z);
  const { blocks } = plan(), stone: THREE.BufferGeometry[] = [], timber: THREE.BufferGeometry[] = [];
  blocks.forEach((b, k) => (b.stuff === 'timber' ? timber : stone).push(shape(b, k, to)));

  const set = STONE.find((id) => assets.manifest.textures[id]) ?? STONE[STONE.length - 1];
  const paint = (tex: string, patch: ShaderPatch, key: string) => {
    const t = assets.pbr(tex);
    return atmo.register(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, roughness: 1, metalness: 0, vertexColors: true }), patch, key);
  };
  const stand = (name: string, shapes: THREE.BufferGeometry[], mat: THREE.Material) => {
    const geo = mergeGeometries(shapes, false);
    if (!geo) return;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  };
  stand('gatehouse:stone', stone, paint(set, weathered(GRADE[set], true), `gatehouse ${set}`));
  stand('gatehouse:timber', timber, paint('weathered_planks', weathered(undefined, false), 'gatehouse timber'));

  if (!physics.world) return; // planning only: no collision world
  for (const b of gatehouseBoxes(p)) {
    physics.addStaticQuat(physics.R.ColliderDesc.cuboid(b.hx, b.hy, b.hz), b.surface, { x: b.x, y: b.y, z: b.z }, { x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) });
  }
}

/**
 * A length of low dry-stone wall out in the world (`World.walls`: see MOUNTAIN.crest in the generator): the middle
 * of it at its foot, which way it runs, how long, how high and how thick.
 */
export interface WallPiece { x: number; y: number; z: number; yaw: number; long: number; high: number; thick: number }

/** What stops a body of such walls: a level box to each length, founded as deep under the ground as the gatehouse is under its yard. */
export function drystoneBoxes(walls: WallPiece[]): { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }[] {
  return walls.map((w) => ({ x: w.x, y: w.y + (w.high - FOOT) / 2, z: w.z, hx: w.long / 2, hy: (w.high + FOOT) / 2, hz: w.thick / 2, yaw: w.yaw }));
}

/**
 * The low walls of the old village on the crest, stood in the world: the gatehouse's stone, block by block as its
 * own walls are (no two quite in line, each top the heart of a wall that broke there), all of them one shape to
 * draw, and a box to each for what stops a body. They are cover to somebody crouched and no more.
 */
export function buildDrystone(walls: WallPiece[], atmo: Atmosphere, scene: THREE.Scene): void {
  if (!walls.length) return;
  const shapes = walls.map((w, k) => {
    const b: Block = { stuff: 'wall', c: [0, (w.high - FOOT) / 2 - DROP, 0], h: [w.long / 2 + 0.06, (w.high + FOOT) / 2, w.thick / 2], yaw: (hash(k, 11, 5) - 0.5) * 0.08, lean: (hash(k, 13, 5) - 0.5) * 0.06, tip: 0, tone: 0.88 + 0.2 * hash(k, 17, 5), open: true, cap: true, loose: true };
    return shape(b, 1000 + k, new THREE.Matrix4().makeRotationY(w.yaw).setPosition(w.x, w.y + DROP, w.z));
  });
  const geo = mergeGeometries(shapes, false);
  if (!geo) return;
  geo.computeBoundingSphere();
  const set = STONE.find((id) => assets.manifest.textures[id]) ?? STONE[STONE.length - 1], t = assets.pbr(set);
  const mesh = new THREE.Mesh(geo, atmo.register(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, roughness: 1, metalness: 0, vertexColors: true }), weathered(GRADE[set], true), `gatehouse ${set}`));
  mesh.name = 'crest:walls';
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  if (!physics.world) return; // planning only: no collision world
  for (const b of drystoneBoxes(walls)) physics.addStaticQuat(physics.R.ColliderDesc.cuboid(b.hx, b.hy, b.hz), 'rock', { x: b.x, y: b.y, z: b.z }, { x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) });
}
