// What makes a room of the bunker look left and not laid out (the owner, 2026-11-01: "add more life to the rooms and environment"): filing cabinets and paper, gas bottles, extinguishers, stopped
// clocks, mops, rubbish and posters, by what each kind of room was for, with blood and spray paint on its walls. It is all seen and none of it is the game's: nothing here is loot or known to the server, and only the tall things
// stop a body. It is laid by rule from each room's own number, so every game has the same rooms, one draw for each thing over a whole level, and only with the eye on that level.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { hash } from '../sim/ruins';
import { DEEP, deepPartAt, deepParts } from '../sim/bunker-deep';
import type { Plan } from '../sim/bunker';

/** a thing to lay: how big, how far out of the wall its middle stands, and how it is turned to look out of the wall (its model's front) */
interface Thing { id: string; w: number; d: number; off: number; turn: number; solid?: boolean; tall?: number }
const T: Record<string, Thing> = {
  cabinet: { id: 'filing_cabinet', w: 0.57, d: 0.75, off: 0.4, turn: 0, solid: true, tall: 1.35 },
  bottles: { id: 'oxygen_bottles', w: 0.63, d: 0.47, off: 0.27, turn: 0, solid: true, tall: 1.6 },
  crate: { id: 'crate_big', w: 1, d: 1, off: 0.56, turn: 0, solid: true, tall: 1 },
  drum: { id: 'barrel_03', w: 0.62, d: 0.62, off: 0.36, turn: 0, solid: true, tall: 0.93 },
  propane: { id: 'propane_tank', w: 0.3, d: 0.3, off: 0.2, turn: 0 },
  paper: { id: 'paper_stack', w: 0.34, d: 0.3, off: 0.3, turn: 0 },
  box: { id: 'cardboard_box_01', w: 0.4, d: 0.5, off: 0.34, turn: 0 },
  bag: { id: 'trashbag', w: 0.5, d: 0.46, off: 0.34, turn: 0 },
  tyre: { id: 'old_tyre', w: 0.6, d: 0.16, off: 0.34, turn: 0 },
  mop: { id: 'mop_bucket', w: 0.8, d: 0.62, off: 0.42, turn: 0 },
  gen: { id: 'portable_generator', w: 0.82, d: 0.56, off: 0.4, turn: 0, solid: true, tall: 0.58 },
  medcab: { id: 'med_cabinet', w: 1.25, d: 0.54, off: 0.3, turn: 0, solid: true, tall: 1.97 },
  sink: { id: 'med_sink', w: 0.57, d: 0.7, off: 0.38, turn: 0, solid: true, tall: 0.93 },
  vent: { id: 'ventilator', w: 0.63, d: 0.63, off: 0.4, turn: 0, solid: true, tall: 1.39 },
  cart: { id: 'computer_cart', w: 0.57, d: 0.79, off: 0.45, turn: 0 },
  medbox: { id: 'medical_box', w: 0.53, d: 0.35, off: 0.3, turn: 0 },
  body: { id: 'covered_body', w: 1.79, d: 0.99, off: 0.8, turn: 0 },
};
/** what stands out on the floor of a big room, left where it was last worked on: each piece of a heap, [what, right, forward, how high] from its middle. The middles of these rooms were bare floor */
const HEAPS: Partial<Record<string, [keyof typeof T, number, number, number][][]>> = {
  stores: [[['crate', 0, 0, 0], ['crate', 1.08, 0.1, 0], ['crate', 0.5, 0.05, 1], ['drum', -1.02, 0.3, 0], ['box', 1.2, 0.9, 0]], [['drum', 0, 0, 0], ['drum', 0.78, 0.1, 0], ['drum', 0.38, 0.76, 0], ['bag', -0.7, -0.3, 0], ['crate', -0.3, -1.2, 0]]],
  workshop: [[['gen', 0, 0, 0], ['propane', 0.8, 0.2, 0], ['bottles', -0.9, 0.2, 0], ['tyre', 0.5, -0.8, 0], ['box', -0.4, -0.9, 0]], [['crate', 0, 0, 0], ['gen', 0.1, 0.05, 1], ['drum', 1.02, 0.2, 0], ['tyre', -1.1, 0.3, 0]]],
  plant: [[['drum', 0, 0, 0], ['drum', 0.78, 0, 0], ['bottles', -0.8, 0.1, 0], ['propane', 0.4, 0.8, 0], ['tyre', 1.4, 0.7, 0]], [['gen', 0, 0, 0], ['crate', 1.1, 0, 0], ['bag', -0.9, 0.3, 0]]],
  armoury: [[['crate', 0, 0, 0], ['crate', 1.05, 0, 0], ['crate', 0.5, 0.1, 1]]],
  archive: [[['cabinet', 0, 0, 0], ['cabinet', 0.6, 0, 0], ['cabinet', 1.2, 0, 0], ['paper', 0.6, 0.75, 0], ['box', -0.5, 0.7, 0]]],
  barracks: [[['crate', 0, 0, 0], ['box', 0.8, 0.2, 0], ['bag', -0.85, 0.2, 0]]],
  medical: [[['body', 0, 0, 0], ['medbox', 1.3, 0.5, 0], ['bag', -1.2, 0.3, 0]], [['vent', 0, 0, 0], ['cart', 0.8, 0.2, 0], ['paper', 0.2, 0.8, 0], ['medbox', -0.8, 0.3, 0]]],
  control: [[['cabinet', 0, 0, 0], ['cabinet', 0.6, 0, 0], ['paper', 0.3, 0.7, 0], ['box', -0.6, 0.4, 0]], [['cart', 0, 0, 0], ['paper', 0.7, 0.2, 0], ['bag', -0.6, 0.3, 0]]],
  washroom: [[['mop', 0, 0, 0], ['drum', 0.95, 0.2, 0], ['bag', -0.8, 0.3, 0]]],
};
/** what hangs on a wall: how high its middle, and how far off it */
const HANG: Record<string, { id: string; y: number; off: number; turn: number }> = {
  clock: { id: 'wall_clock', y: 2.15, off: 0.04, turn: 0 },
  extinguisher: { id: 'fire_extinguisher', y: 1.25, off: 0.12, turn: 0 },
};
interface Kit { wall: (keyof typeof T)[]; floor: (keyof typeof T)[]; hang: (keyof typeof HANG | 'poster')[] }
const KITS: Record<string, Kit> = {
  control: { wall: ['cabinet'], floor: ['paper', 'box', 'bag'], hang: ['clock', 'poster'] },
  archive: { wall: ['cabinet', 'cabinet', 'crate'], floor: ['paper', 'paper', 'box'], hang: ['clock', 'extinguisher'] },
  plant: { wall: ['bottles', 'drum', 'propane', 'crate'], floor: ['tyre', 'bag', 'mop'], hang: ['extinguisher', 'poster', 'poster'] },
  stores: { wall: ['crate', 'drum', 'bottles'], floor: ['box', 'bag', 'tyre'], hang: ['extinguisher', 'poster'] },
  medical: { wall: ['medcab', 'bottles', 'sink', 'cabinet', 'vent'], floor: ['medbox', 'mop', 'paper', 'cart', 'bag', 'body'], hang: ['clock', 'poster', 'extinguisher'] },
  quarters: { wall: ['cabinet'], floor: ['bag', 'paper', 'box'], hang: ['clock', 'poster'] },
  armoury: { wall: ['crate', 'drum'], floor: ['box', 'paper'], hang: ['extinguisher', 'poster'] },
  washroom: { wall: ['drum'], floor: ['mop', 'bag'], hang: ['extinguisher'] },
  workshop: { wall: ['bottles', 'crate', 'drum'], floor: ['tyre', 'bag', 'box'], hang: ['extinguisher', 'poster'] },
  barracks: { wall: ['cabinet'], floor: ['bag', 'box', 'paper'], hang: ['clock', 'poster', 'poster'] },
  kitchen: { wall: ['drum', 'crate'], floor: ['bag', 'mop', 'box'], hang: ['clock', 'extinguisher'] },
  mess: { wall: ['crate'], floor: ['bag', 'mop', 'box'], hang: ['clock', 'poster', 'poster'] },
  cells: { wall: [], floor: ['bag'], hang: ['poster'] },
};

/** how much floor furniture holds, m, where it is more than the usual: a bank of body lockers is four metres long */
const WIDE: Record<string, number> = { zil_wreck: 3.4, tractor_wreck: 2.6, body_lockers: 2.4, bunker_machine: 1.7, old_bed_frame: 1.2, metal_office_desk: 1.2 };
/** rooms that stay as they were made: what is in them is the whole of the place (the vault's racks; the theatre's seats) */
const SPARED = /vault|anatomy|under the landing|sump/i;

/** what can be on a wall, one sheet of it: its place there in pixels of 1024, how tall it is on a wall, how high its middle */
const MARKS: Record<string, { box: [number, number, number, number]; tall: number; y: number }> = {
  drag: { box: [57, 13, 178, 366], tall: 1.05, y: 1.2 },
  hand: { box: [243, 34, 460, 343], tall: 0.42, y: 1.3 },
  spatter: { box: [515, 17, 745, 360], tall: 1, y: 1.2 },
  hands: { box: [783, 47, 994, 352], tall: 0.75, y: 1.25 },
  arrow: { box: [9, 402, 265, 620], tall: 0.5, y: 1.45 },
  ring: { box: [277, 385, 498, 643], tall: 0.7, y: 1.5 },
  skull: { box: [527, 379, 730, 658], tall: 0.85, y: 1.5 },
  trefoil: { box: [754, 392, 1012, 667], tall: 0.8, y: 1.55 },
  cross: { box: [9, 687, 251, 985], tall: 0.85, y: 1.4 },
  tally: { box: [269, 724, 490, 953], tall: 0.55, y: 1.5 },
  eye: { box: [509, 735, 762, 944], tall: 0.55, y: 1.6 },
  rust: { box: [800, 686, 993, 1012], tall: 1.3, y: 2.1 },
};
/** half its width, at a height */
const wideOf = (m: { box: [number, number, number, number] }, tall: number) => (tall * (m.box[2] - m.box[0])) / (m.box[3] - m.box[1]) / 2;
/** what a kind of room has on its walls. No arrows here: an arrow on a wall in this bunker is always a way (bunker-deep's `marks`, the main passage) */
const LEFT: Record<string, string[]> = {
  control: ['hand', 'rust', 'eye'],
  archive: ['rust', 'spatter', 'tally'],
  plant: ['rust', 'rust', 'trefoil', 'drag'],
  stores: ['rust', 'hand', 'ring'],
  medical: ['hand', 'drag', 'spatter', 'hands'],
  quarters: ['tally', 'hand', 'eye'],
  armoury: ['cross', 'tally', 'skull'],
  washroom: ['rust', 'rust', 'hand'],
  workshop: ['rust', 'ring', 'trefoil'],
  barracks: ['tally', 'hands', 'skull'],
  kitchen: ['rust', 'spatter'],
  mess: ['spatter', 'drag', 'hand', 'eye'],
  cells: ['tally', 'hands', 'tally', 'drag', 'hand'],
};
/** how far off the wall a mark lies, and how much further each of a few: two of them in one plane would flicker */
const OFF = 0.006, STEP = 0.0012;
/** what lies along a passage, a wall's run at a time: how far apart at the least, and what could be there */
const RUN = 6, PASSAGE = ['rust', 'hand', 'drag', 'spatter', 'rust', 'tally', 'hand'], LITTER: (keyof typeof T)[] = ['paper', 'bag', 'box'];
/** where water comes through: kinds of room, and rooms by name */
const WET = /^(washroom|plant|stores)$/, WET_NAMED = /cold room|sump|pump/i;

/** a poster's place on the sheet: [left, top] of six, three across */
const SHEET = { across: 3, down: 2, w: 0.62, h: 0.9, y: 1.65 };

interface Laid { id: string; turn: number; r: number; f: number; y: number; rot: number }
interface Mark { r: number; f: number; y: number; rot: number; name: string; tall: number; flip?: boolean; tilt?: number }
/** what moves, [right, forward, height over the level]: for water, also where it comes from */
export interface Life { flies: [number, number, number][]; drips: [number, number, number, number][]; sparks: [number, number, number][]; steam: [number, number, number][] }
export interface Dressed { things: Laid[]; posters: { r: number; f: number; y: number; rot: number; k: number }[]; marks: Mark[]; life: Life; solid: { r: number; f: number; y: number; rot: number; w: number; d: number; h: number }[] }

/** what stands high enough against a wall to hide what hangs there */
const tallAt = (s: { id: string }) => /Shelf|bookshelf|locker|cabinet|rack|bunker_machine|container/i.test(s.id);

// (a place along a wall of a room: which of the four by their lengths, how far along, and which way it looks into the room)
function onWall(plan: Plan, q: Plan['rooms'][number], u: number, v: number, inset: number): [number, number, number, number, number] | null {
  const W = q.r1 - q.r0, D = q.f1 - q.f0, floor = q.y ?? 0;
  const t = u * (W + D) * 2, side = t < W ? 0 : t < W + D ? 1 : t < W * 2 + D ? 2 : 3, a = 0.5 + v * (side % 2 ? D - 1 : W - 1);
  const [r, f, rot, or, of] = side === 0 ? [q.r0 + a, q.f0 + inset, 0, 0, -1] : side === 1 ? [q.r1 - inset, q.f0 + a, -Math.PI / 2, 1, 0] : side === 2 ? [q.r0 + a, q.f1 - inset, Math.PI, 0, 1] : [q.r0 + inset, q.f0 + a, Math.PI / 2, -1, 0];
  // (a real wall behind it, not a pane or a way through)
  const wr = r + or * (inset + 0.12), wf = f + of * (inset + 0.12);
  const behind = plan.walls.filter((w) => wr > w.r0 && wr < w.r1 && wf > w.f0 && wf < w.f1 && floor + 1.4 >= (w.y0 ?? 0) && floor + 1.4 <= (w.y1 ?? 3));
  if (!behind.length) return null;
  if (q.doors.some(([dr, df]) => Math.hypot(dr - r, df - f) < 1.5)) return null;
  // (measured from that wall's own face: the deep levels' walls stand astride a room's edge, and what was laid from the edge was inside them)
  const face = side === 0 ? Math.max(...behind.map((w) => w.f1)) + inset : side === 1 ? Math.min(...behind.map((w) => w.r0)) - inset : side === 2 ? Math.min(...behind.map((w) => w.f0)) - inset : Math.max(...behind.map((w) => w.r1)) + inset;
  return [side % 2 ? face : r, side % 2 ? f : face, rot, or, of];
}

/** Where it all goes in a plan. Pure, and the same in every game. */
export function dressPlan(plan: Plan): Dressed {
  const out: Dressed = { things: [], posters: [], marks: [], life: { flies: [], drips: [], sparks: [], steam: [] }, solid: [] }, hungAll: [number, number][] = [];
  const deep = plan.deep ? DEEP[plan.deep] : null, parts = plan.deep ? deepParts(plan.deep) : null;
  const inBox = (b: { r0: number; r1: number; f0: number; f1: number }, r: number, f: number) => r > b.r0 && r < b.r1 && f > b.f0 && f < b.f1;
  // (the plain floor of that height all round a spot: no stair, deck or step, no glass, tank or water. The rule-laid levels are all floor)
  const flat = (r: number, f: number, rad: number, y: number) => !deep || [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad]].every(([x, z]) => {
    const pr = r + x, pf = f + z, k = deepPartAt(parts!, pr, pf, y);
    return k >= 0 && !parts![k].low && Math.abs(parts![k].y - y) < 0.05 && !deep.masses.some((m) => inBox(m, pr, pf) && y + 0.2 > m.y0 && y < m.y1) && !deep.water.some((w) => inBox(w, pr, pf)) && !deep.floors.some((w) => inBox(w, pr, pf)) && !deep.tanks.some((t) => Math.hypot(t.r - pr, t.f - pf) < t.rad + 0.3);
  });
  /** a wall behind all four corners of a mark */
  const backed = (r: number, f: number, rot: number, x: number, h: number, y: number) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [[-x, -h], [x, -h], [x, h], [-x, h]].every(([lx, ly]) => {
      const br = r + lx * c - s * 0.05, bf = f - lx * s - c * 0.05;
      return plan.walls.some((w) => inBox(w, br, bf) && y + ly >= (w.y0 ?? 0) && y + ly <= (w.y1 ?? 3));
    });
  };
  const held: { r: number; f: number; rad: number }[] = [...plan.stood.map((s) => ({ r: s.r, f: s.f, rad: WIDE[s.id] ?? 0.8 })), ...plan.made.filter((m) => m.solid !== false).map((m) => ({ r: m.r, f: m.f, rad: Math.max(m.w, m.d) / 2 + 0.2 })), ...plan.spots.map((s) => ({ r: s.r, f: s.f, rad: 0.3 }))];
  const clear = (r: number, f: number, rad: number) => !held.some((h) => Math.hypot(h.r - r, h.f - f) < h.rad + rad);
  // (a wall anywhere about a spot, of those that stand on this floor)
  const walled = (r: number, f: number, rad: number, y: number) => plan.walls.some((w) => (w.y0 ?? 0) < y + 1 && (w.y1 ?? 3) > y + 0.2 && r + rad > w.r0 && r - rad < w.r1 && f + rad > w.f0 && f - rad < w.f1);
  // (the foot of a ladder and either end of a stair are ways too: nothing is left where a body comes off them)
  if (deep) {
    for (const l of deep.ladders) held.push({ r: l.r + l.nr * 0.6, f: l.f + l.nf * 0.6, rad: 1.3 });
    for (const q of deep.flights) {
      const across = q.up[0] === 'r', mid = across ? (q.f0 + q.f1) / 2 : (q.r0 + q.r1) / 2;
      for (const end of across ? [q.r0, q.r1] : [q.f0, q.f1]) held.push({ r: across ? end : mid, f: across ? mid : end, rad: 1.6 });
    }
  }
  plan.rooms.forEach((q, n) => {
    const kit = KITS[q.kind];
    if (!kit || SPARED.test(q.name)) return;
    const W = q.r1 - q.r0, D = q.f1 - q.f0, area = W * D, floor = q.y ?? 0, roll = (k: number) => hash(n, k, 4177), top = plan.areas?.find((a) => a.name === q.name)?.top;
    if (top !== undefined && top - floor < 2.4) return;
    const along = (u: number, v: number, inset: number) => onWall(plan, q, u, v, inset);
    let k = 0;
    const hanging: [number, number][] = [];
    const lay = (name: keyof typeof T, tries: number) => {
      const t = T[name];
      for (let i = 0; i < tries; i++) {
        const at = along(roll(k++), roll(k++), t.off), rad = Math.max(t.w, t.d) / 2 + 0.12;
        if (!at || !clear(at[0], at[1], rad) || !flat(at[0], at[1], rad, floor)) continue;
        const side = t.w / 2 + 0.05;
        if ([-side, side].some((k) => walled(at[0] + k * Math.abs(at[4]), at[1] + k * Math.abs(at[3]), 0.02, floor))) continue;
        held.push({ r: at[0], f: at[1], rad });
        out.things.push({ id: t.id, turn: t.turn, r: at[0], f: at[1], y: floor, rot: at[2] + (t.solid ? 0 : (roll(k++) - 0.5) * 0.9) });
        if (t.solid) out.solid.push({ r: at[0], f: at[1], y: floor, rot: at[2], w: t.w, d: t.d, h: t.tall ?? 1 });
        return;
      }
    };
    const walls = Math.min(7, 1 + Math.ceil(area / 45)), bits = Math.min(10, 2 + Math.ceil(area / 26)), hung = Math.min(7, Math.ceil((W + D) / 6));
    // (out on the floor of a big room first, while there is room for it: a heap to a square of nine metres, clear of its ways in and of what stands there)
    const heaps = HEAPS[q.kind];
    if (heaps && area > 90) {
      const across = Math.max(1, Math.floor(W / 9)), down = Math.max(1, Math.floor(D / 9));
      let laid = 0;
      for (let i = 0; i < across; i++) for (let j = 0; j < down; j++) {
        if (laid >= 4) continue;
        // (a few tries about the middle of its square: a room's places for loot lie all over its floor, and a heap is not to be stood on one)
        let cr = 0, cf = 0, found = false;
        for (let tr = 0; tr < 10 && !found; tr++) {
          cr = q.r0 + (W * (i + 0.5)) / across + (roll(k++) - 0.5) * 4;
          cf = q.f0 + (D * (j + 0.5)) / down + (roll(k++) - 0.5) * 4;
          found = !q.doors.some(([dr, df]) => Math.hypot(dr - cr, df - cf) < 3) && clear(cr, cf, 1.3) && flat(cr, cf, 1.7, floor) && !walled(cr, cf, 1.7, floor) && cr - q.r0 > 2.4 && q.r1 - cr > 2.4 && cf - q.f0 > 2.4 && q.f1 - cf > 2.4;
        }
        if (!found) continue;
        held.push({ r: cr, f: cf, rad: 2 });
        laid++;
        const rot = Math.floor(roll(k++) * 4) * (Math.PI / 2) + (roll(k++) - 0.5) * 0.3, c = Math.cos(rot), s = Math.sin(rot), heap = heaps[Math.floor(roll(k++) * heaps.length)];
        for (const [name, x, z, y] of heap) {
          const t = T[name], r = cr + x * c + z * s, f = cf - x * s + z * c, turn = rot + (t.solid ? (roll(k++) - 0.5) * 0.14 : roll(k++) * 6.28);
          out.things.push({ id: t.id, turn: t.turn, r, f, y: floor + y, rot: turn });
          if (t.solid) out.solid.push({ r, f, y: floor + y, rot: turn, w: t.w, d: t.d, h: t.tall ?? 1 });
        }
      }
    }
    if (kit.wall.length) for (let i = 0; i < walls; i++) lay(kit.wall[i % kit.wall.length], 24);
    if (kit.floor.length) for (let i = 0; i < bits; i++) lay(kit.floor[i % kit.floor.length], 24);
    for (let i = 0; i < hung && kit.hang.length; i++) {
      const name = kit.hang[i % kit.hang.length];
      // (over whatever is low against the wall: only what stands as high would hide it)
      for (let tr = 0; tr < 24; tr++) {
        const at = along(roll(k++), roll(k++), 0.03);
        if (!at || hanging.some((h) => Math.hypot(h[0] - at[0], h[1] - at[1]) < 1.1) || plan.stood.some((s) => tallAt(s) && Math.hypot(s.r - at[0], s.f - at[1]) < 0.9) || out.solid.some((s) => s.h > 1.15 && Math.hypot(s.r - at[0], s.f - at[1]) < 0.9)) continue;
        // (an extinguisher hangs at the height of whatever stands there)
        if (name === 'extinguisher' && !clear(at[0], at[1], 0.35)) continue;
        hanging.push([at[0], at[1]]);
        hungAll.push([at[0], at[1]]);
        held.push({ r: at[0], f: at[1], rad: 0.45 });
        if (name === 'poster') out.posters.push({ r: at[0], f: at[1], y: floor + SHEET.y, rot: at[2], k: Math.floor(roll(k++) * SHEET.across * SHEET.down) });
        else {
          const h = HANG[name], or = at[3], of = at[4];
          out.things.push({ id: h.id, turn: h.turn, r: at[0] - or * h.off, f: at[1] - of * h.off, y: floor + h.y, rot: at[2] });
        }
        break;
      }
    }
  });
  // What was left on the walls, in the bare great rooms too: after all the rest, so nothing above moves for it.
  for (const m of plan.made) if (m.kind === 'mark') out.marks.push({ r: m.r + Math.sin(m.rot) * OFF, f: m.f + Math.cos(m.rot) * OFF, y: (m.y ?? 0) + m.h / 2, rot: m.rot, name: m.text ?? '', tall: m.h, flip: m.flip, tilt: m.tilt });
  const tall = [...out.solid.filter((s) => s.h > 1.2), ...plan.stood.filter(tallAt), ...plan.made.filter((m) => m.solid !== false && m.h > 1.2)];
  plan.rooms.forEach((q, n) => {
    const kinds = LEFT[q.kind] ?? LEFT.stores, floor = q.y ?? 0, roll = (k: number) => hash(n, k, 5309), many = Math.min(5, 1 + Math.floor(((q.r1 - q.r0) * (q.f1 - q.f0)) / 40));
    let k = 0;
    for (let i = 0; i < many; i++) for (let tr = 0; tr < 12; tr++) {
      const at = onWall(plan, q, roll(k++), roll(k++), OFF + (out.marks.length % 6) * STEP);
      if (!at || hungAll.some((h) => Math.hypot(h[0] - at[0], h[1] - at[1]) < 1.2) || out.marks.some((m) => Math.hypot(m.r - at[0], m.f - at[1]) < 1.5) || tall.some((s) => Math.hypot(s.r - at[0], s.f - at[1]) < 1)) continue;
      const name = kinds[i % kinds.length], mark = MARKS[name], y = floor + mark.y + (roll(k++) - 0.5) * 0.2, high = mark.tall * (0.85 + roll(k++) * 0.3), flip = roll(k++) < 0.5;
      // (wall behind all four of its corners, not the end of a short one, nor over its top)
      if (!backed(at[0], at[1], at[2], wideOf(mark, high), high / 2, y)) continue;
      out.marks.push({ r: at[0], f: at[1], y, rot: at[2], name, tall: high, flip });
      break;
    }
  });
  // What lies along the passages: a run of wall at a time, on whichever side of it is a way and not a room, a wall or the rock.
  const inRoom = (r: number, f: number) => plan.rooms.some((q) => inBox(q, r, f));
  plan.walls.forEach((w, n) => {
    const across = w.r1 - w.r0 > w.f1 - w.f0, from = across ? w.r0 : w.f0, to = across ? w.r1 : w.f1, roll = (k: number) => hash(n, k, 6131);
    if (to - from < 2.5 || (w.y1 ?? 3) - (w.y0 ?? 0) < 2.2) return;
    let k = 0;
    for (const side of [-1, 1]) for (let a = from + 1 + roll(k++) * 2; a < to - 1; a += RUN + roll(k++) * 5) {
      const face = across ? (side > 0 ? w.f1 : w.f0) : side > 0 ? w.r1 : w.r0, rot = across ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
      const at = (off: number): [number, number] => (across ? [a, face + side * off] : [face + side * off, a]);
      const [pr, pf] = at(0.5);
      if (roll(k++) < 0.35 || inRoom(pr, pf) || plan.walls.some((o) => inBox(o, pr, pf) && (o.y1 ?? 3) > (w.y0 ?? 0) + 1) || (plan.areas && !plan.areas.some((b) => !b.under && inBox(b, pr, pf)))) continue;
      if (plan.rooms.some((q) => q.doors.some(([dr, df]) => Math.hypot(dr - pr, df - pf) < 1.8))) continue;
      const part = parts ? deepPartAt(parts, pr, pf, (w.y0 ?? 0) + 0.1) : -1, floor = part >= 0 ? parts![part].y : w.y0 ?? 0;
      if (parts && (part < 0 || !flat(pr, pf, 0.3, floor))) continue;
      const [mr, mf] = at(OFF + (out.marks.length % 6) * STEP), name = PASSAGE[Math.floor(roll(k++) * PASSAGE.length)], mark = MARKS[name], high = mark.tall * (0.85 + roll(k++) * 0.3), y = floor + mark.y + (roll(k++) - 0.5) * 0.2, flip = roll(k++) < 0.5;
      if (!out.marks.some((m) => Math.hypot(m.r - mr, m.f - mf) < 1.5) && !tall.some((s) => Math.hypot(s.r - mr, s.f - mf) < 1) && backed(mr, mf, rot, wideOf(mark, high), high / 2, y)) out.marks.push({ r: mr, f: mf, y, rot, name, tall: high, flip });
      if (roll(k++) < 0.4) {
        const b = T[LITTER[Math.floor(roll(k++) * LITTER.length)]], [lr, lf] = at(b.off + 0.1 + roll(k++) * 0.2);
        if (clear(lr, lf, 0.4)) {
          held.push({ r: lr, f: lf, rad: 0.4 });
          out.things.push({ id: b.id, turn: b.turn, r: lr, f: lf, y: floor, rot: rot + roll(k++) * 6.28 });
        }
      }
    }
  });
  // And what moves, each thing at what would make it: flies on the dead and on old blood, sparks from what has current in it, steam off pipes, water through the roof of the wet rooms.
  const fly = out.life.flies, here = [...plan.stood, ...out.things];
  for (const s of here) if (s.id === 'covered_body') fly.push([s.r, s.f, (s.y ?? 0) + 0.65]);
  for (const m of plan.made) if (m.kind === 'stain' && m.w > 1.2 && !fly.some((o) => Math.hypot(o[0] - m.r, o[1] - m.f) < 3)) fly.push([m.r, m.f, (m.y ?? 0) + 0.3]);
  for (const s of plan.stood) if (/^(breaker_box|utility_box_01|bunker_terminal)$/.test(s.id)) out.life.sparks.push([s.r, s.f, (s.y ?? 0) + 1.35]);
  for (const s of plan.stood) if (/^(bunker_pipes?|valve_stand)$/.test(s.id)) out.life.steam.push([s.r, s.f, (s.y ?? 0) + 1.25]);
  plan.rooms.forEach((q, n) => {
    if (!WET.test(q.kind) && !WET_NAMED.test(q.name)) return;
    const floor = q.y ?? 0, top = plan.areas?.find((a) => a.name === q.name)?.top ?? 2.9, roll = (k: number) => hash(n, k, 7349), many = Math.min(4, 1 + Math.floor(((q.r1 - q.r0) * (q.f1 - q.f0)) / 70));
    for (let i = 0, k = 0; i < many; i++) for (let tr = 0; tr < 8; tr++) {
      const r = q.r0 + 1 + roll(k++) * (q.r1 - q.r0 - 2), f = q.f0 + 1 + roll(k++) * (q.f1 - q.f0 - 2);
      if (!clear(r, f, 0.5) || !flat(r, f, 0.3, floor)) continue;
      out.life.drips.push([r, f, floor, top - 0.05]);
      break;
    }
  });
  return out;
}

let sheet: THREE.MeshStandardMaterial | null = null, marks: THREE.MeshStandardMaterial | null = null;

/** flat things on walls, one sheet and one thing to draw: where each is, its half width and height, the turn on the wall, and its place on the sheet */
interface Flat { r: number; f: number; y: number; rot: number; x: number; h: number; tilt?: number; uv: [number, number, number, number] }
function flats(list: Flat[], Y: number, paint: THREE.Material, group: THREE.Object3D) {
  if (!list.length) return;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const o of list) {
    const c = Math.cos(o.rot), s = Math.sin(o.rot), tc = Math.cos(o.tilt ?? 0), ts = Math.sin(o.tilt ?? 0), [u0, v0, u1, v1] = o.uv, base = pos.length / 3;
    for (const [ax, ay] of [[-o.x, -o.h], [o.x, -o.h], [o.x, o.h], [-o.x, o.h]]) {
      const lx = ax * tc - ay * ts, ly = ax * ts + ay * tc;
      pos.push(o.r + lx * c, Y + o.y + ly, o.f - lx * s);
    }
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, paint);
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
}

/** how far off what dresses a room is drawn, metres, and how far the eye goes before that is looked at again. A level holds some hundreds of these at a few thousand triangles each, and walls hide nearly all of them */
const SEEN = 42, MOVED = 3;
/** what lies on a floor, small and in a dark room, is not looked for from as far (m) */
const SMALL = /paper_stack|trashbag|cardboard_box|old_tyre|mop_bucket|propane_tank|medical_box|fire_extinguisher|wall_clock/, SEEN_SMALL = 26;

/** a model's paint in the bunker: one for all its levels, told to the day and the dark once */
const paints = new Map<string, THREE.MeshStandardMaterial>();

/**
 * It stood in the level, every kind of thing a list of its own. @param register how a paint is told to the day and the dark @param solid what stops a body
 * @returns what moves in it, `look`: what is near the eye, the rest not drawn, and `load`: everything it takes sent for, once the eye comes near the bunker. Most lives never go down, and a phone has better things to hold
 */
export function dressLevel(plan: Plan, Y: number, group: THREE.Object3D, register: (m: THREE.MeshStandardMaterial) => THREE.MeshStandardMaterial, selfLit: (m: THREE.MeshStandardMaterial, k: number) => THREE.MeshStandardMaterial, solid: (s: Dressed['solid'][number]) => void) {
  const d = dressPlan(plan), byId = new Map<string, Laid[]>();
  for (const t of d.things) (byId.get(t.id) ?? byId.set(t.id, []).get(t.id)!).push(t);
  for (const s of d.solid) solid(s);
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const sets: { many: THREE.InstancedMesh; all: Float32Array; list: Laid[]; far: number }[] = [];
  let lastR = Infinity, lastF = Infinity;
  const look = (r: number, f: number) => {
    if (Math.hypot(r - lastR, f - lastF) < MOVED) return;
    lastR = r;
    lastF = f;
    for (const { many, all, list, far } of sets) {
      const to = many.instanceMatrix.array as Float32Array;
      let n = 0;
      list.forEach((t, i) => {
        if (Math.hypot(t.r - r, t.f - f) < far) to.set(all.subarray(i * 16, i * 16 + 16), n++ * 16);
      });
      many.count = n;
      many.instanceMatrix.needsUpdate = true;
    }
  };
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    for (const [id, list] of byId) {
      void assets.model(id).then((root) => {
        root.updateMatrixWorld(true);
        root.traverse((o) => {
          const src = o as THREE.Mesh;
          if (!src.isMesh) return;
          // (no see-through glass: that shader asks for the camera's matrix a second time beside what the paints are ranked with, and a generator's gauge failed to draw at all)
          const made = src.material as THREE.MeshStandardMaterial;
          const paint = paints.get(made.uuid) ?? register(selfLit(Object.assign(made.clone(), { metalness: 0.15, transmission: 0 }), id === 'filing_cabinet' || id === 'oxygen_bottles' ? 0.1 : 0.18));
          paints.set(made.uuid, paint);
          const many = new THREE.InstancedMesh(src.geometry, paint, list.length), m = new THREE.Matrix4(), all = new Float32Array(list.length * 16);
          list.forEach((t, i) => m.compose(p.set(t.r, Y + t.y, t.f), q.setFromAxisAngle(up, t.rot + t.turn), one).multiply(src.matrixWorld).toArray(all, i * 16));
          many.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          many.count = 0;
          many.frustumCulled = false;
          many.receiveShadow = true;
          group.add(many);
          sets.push({ many, all, list, far: SMALL.test(id) ? SEEN_SMALL : SEEN });
          lastR = Infinity;
        });
      }).catch(() => {});
    }
    // (the posters: one sheet of pictures, one thing to draw)
    sheet ??= register(selfLit(new THREE.MeshStandardMaterial({ map: assets.texture('assets/tex/posters.webp', { srgb: true, repeat: false }), roughness: 0.9, metalness: 0 }), 0.35));
    const A = SHEET.across, B = SHEET.down;
    flats(d.posters.map((o) => {
      const u0 = (o.k % A) / A, v1 = 1 - Math.floor(o.k / A) / B;
      return { r: o.r, f: o.f, y: o.y, rot: o.rot, x: SHEET.w / 2, h: SHEET.h / 2, uv: [u0 + 0.008, v1 - 1 / B + 0.008, u0 + 1 / A - 0.008, v1 - 0.008] as Flat['uv'] };
    }), Y, sheet, group);
    // (the marks: paint on the wall, over whatever the wall's own rank is)
    if (!marks) {
      marks = register(selfLit(new THREE.MeshStandardMaterial({ map: assets.texture('assets/tex/marks.webp', { srgb: true, repeat: false }), transparent: true, depthWrite: false, roughness: 0.85, metalness: 0 }), 0.22));
      marks.polygonOffset = true;
      marks.polygonOffsetFactor = -4;
      marks.polygonOffsetUnits = -30;
    }
    flats(d.marks.flatMap((o) => {
      const m = MARKS[o.name];
      if (!m) return [];
      const [l, t, r, b] = m.box, S = 1024, u0 = l / S, u1 = r / S;
      return [{ r: o.r, f: o.f, y: o.y, rot: o.rot, x: wideOf(m, o.tall), h: o.tall / 2, tilt: o.tilt, uv: [o.flip ? u1 : u0, 1 - b / S, o.flip ? u0 : u1, 1 - t / S] as Flat['uv'] }];
    }), Y, marks, group);
  };
  return { life: d.life, look, load };
}
