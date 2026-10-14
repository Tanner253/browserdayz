// Basements (2026-10-14). The owner: "I WANT TO GET BASEMENTS IN, not every building needs a basement but i think
// this is a dynamic way for us to expand our game easily"; and of the plan: "we can have double basements, we cna
// have multiple rooms down stairs, or 2 floors down ... dont be afraid to make use of the space ... dont be boring".
//
// About four homes in ten have one, chosen by the map's own dice (the same on every machine and every restart), and
// some barns a storm cellar in the yard. The way down is a cellar door beside the house and a flight of steps; the
// rooms are under the earth, as far from the house as they like, with 0.8 m of earth over every one of them, so that
// nothing of the ground or of the house above is changed but the opening of the steps. There the ground is not drawn,
// not stood on and not hit (`inWell`).
//
// Plain data, shared: the game builds it (src/world/basement-build.ts), the server lets whoever is down there be
// (`basementUnder`), and both lay out its places for things (src/world/buildings.ts, after every other place).

import { RNG } from '../core/noise';
import { BUILDING_FOOTPRINT, heightAt, type BuildingPlot, type World } from '../world/worldgen';

export type Layout = 'root' | 'work' | 'hide' | 'double' | 'deep' | 'storm';
export type RoomKind = 'stair' | 'root' | 'work' | 'closet' | 'hall' | 'bunk' | 'store' | 'vault' | 'shaft';
/** what a room's walls, floor and ceiling are made of */
export type Skin = 'brick' | 'concrete' | 'plaster';

/** A room, in the house's own frame (x along its front, z out of its front: see BuildingPlot). Heights are the world's. */
export interface Room {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** its floor */
  y: number;
  /** floor to ceiling */
  h: number;
  kind: RoomKind;
  level: 1 | 2;
  /** the stretch of z that has a floor (a flight takes the rest); unsaid, all of it; null, none */
  floor?: [number, number] | null;
  /** it has a ceiling of its own height (the stairs' room is roofed by the earth's line: see the builder) */
  ceil: boolean;
  skin: Skin;
}

/** A straight flight along z (as src/world/buildings.ts lays them): from its foot at z = foot, y0, to its head at z = top, y1. */
export interface Flight {
  x0: number;
  x1: number;
  foot: number;
  top: number;
  y0: number;
  y1: number;
}

/** A way through between two rooms of one level: the gap in the wall on the line between them (x0 === x1, or z0 === z1). */
export interface Doorway {
  level: 1 | 2;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}

/** Something stood in it off the shelf (frame; y the world's), and the places for things. */
export interface Thing {
  id: string;
  x: number;
  z: number;
  y: number;
  rot: number;
}
export interface Spot {
  x: number;
  z: number;
  y: number;
  floor: boolean;
  room: number;
}

export interface Basement {
  plot: string;
  type: BuildingPlot['type'];
  x: number;
  z: number;
  rot: number;
  layout: Layout;
  rooms: Room[];
  flights: Flight[];
  doors: Doorway[];
  /** the steps' opening, where the ground is not: in the frame, and the ground's height at its head */
  well: { x0: number; x1: number; z0: number; z1: number; top: number };
  /** the opening's corners in the world, [x, z] */
  hole: [number, number][];
  /** the world's box round all of it, [x0, z0, x1, z1] */
  box: [number, number, number, number];
  things: Thing[];
  spots: Spot[];
  /** where its lamps hang (frame; y the world's) */
  lamps: [number, number, number][];
  /** how many steps of the map better each room's places are than the house's own (0 to 2) */
  better: number[];
}

/** a room's height, the thickness of a floor or a ceiling, the earth over a ceiling, a stair's riser and tread */
export const CELLAR = { h: 2.4, slab: 0.2, earth: 0.8, rise: 0.2, tread: 0.25, wide: 1.2, landing: 1.4, headroom: 2.4 };

const HOMES = new Set<BuildingPlot['type']>(['house_small', 'house_brick', 'house_two', 'townhouse', 'cabin']);
const LAYOUTS: [Layout, number][] = [['root', 22], ['work', 20], ['hide', 20], ['double', 20], ['deep', 18]];

/** what a thing off the shelf measures: along its front, up, deep; and how far its back is behind its origin */
const SIZE: Record<string, [number, number, number, number]> = {
  // (drawn by its middle, as everything off the shelf is: its file's bounds ran from its back, and a shelf put by them stood half in the wall)
  Shelf_01: [1.0, 2.08, 0.26, -0.13],
  wooden_bookshelf_worn: [1.37, 2.06, 0.58, -0.29],
  Barrel_01: [0.56, 0.88, 0.56, -0.28],
  barrel_03: [0.63, 0.93, 0.64, -0.32],
  cardboard_box_01: [0.39, 0.34, 0.52, -0.23],
  utility_box_01: [0.52, 1.12, 0.43, -0.21],
  metal_jerrycan_green: [0.36, 0.5, 0.17, -0.09],
  WoodenTable_01: [1.8, 0.55, 0.66, -0.33],
  painted_wooden_table: [2.41, 0.96, 1.14, -0.57],
  painted_wooden_chair_01: [0.43, 0.96, 0.54, -0.3],
  old_bed_frame: [0.9, 1.2, 2.0, -1.0],
  rack_small: [1.19, 1.88, 0.62, -0.31],
  rack_wide: [1.81, 1.88, 0.61, -0.31],
  steel_locker: [1.08, 2.0, 0.55, -0.28],
  wooden_crate_01: [0.83, 0.35, 0.41, -0.2],
  wooden_military_crate: [1.24, 0.46, 0.52, -0.26],
  old_military_crate: [1.82, 0.3, 0.98, -0.67],
  weapons_case: [1.25, 0.43, 0.53, -0.26],
  painted_wooden_cabinet: [1.19, 1.18, 0.62, -0.28],
  metal_office_desk: [2.0, 0.79, 0.95, -0.47],
};

/** What each kind of room has in it, in the order it is stood against the walls; `?` before an id: on a throw of the dice. */
const DRESS: Record<RoomKind, string[]> = {
  stair: [],
  shaft: [],
  hall: ['?Barrel_01'],
  root: ['Shelf_01', 'Shelf_01', 'wooden_crate_01', 'Barrel_01', 'barrel_03', '?Shelf_01', '?cardboard_box_01', '?wooden_crate_01'],
  work: ['WoodenTable_01', 'rack_small', 'steel_locker', 'wooden_crate_01', '?metal_jerrycan_green', '?utility_box_01', '?Barrel_01'],
  // (A crate in every closet waits for the next time the basements are laid out afresh: the order here is drawn from
  // one roll of the dice for the whole basement, and a closet laid out otherwise moved everything after it, the
  // places of things that lie in the basements now among them.)
  closet: ['Shelf_01', 'cardboard_box_01', '?wooden_crate_01', '?metal_jerrycan_green'],
  bunk: ['old_bed_frame', 'old_bed_frame', 'steel_locker', 'WoodenTable_01', 'painted_wooden_chair_01', '?wooden_military_crate', '?cardboard_box_01'],
  store: ['rack_wide', 'wooden_crate_01', 'Shelf_01', 'barrel_03', 'cardboard_box_01', '?rack_small', '?Barrel_01', '?cardboard_box_01'],
  vault: ['weapons_case', 'steel_locker', 'wooden_military_crate', 'rack_small', '?old_military_crate'],
};
/** how many places for things each kind of room has, besides what is searched */
const SPOTS: Record<RoomKind, number> = { stair: 0, shaft: 0, hall: 1, root: 3, work: 3, closet: 2, bunk: 3, store: 3, vault: 3 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** a point of the frame in the world */
export function frameToWorld(b: { x: number; z: number; rot: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
}
/** a point of the world in the frame */
export function worldToFrame(b: { x: number; z: number; rot: number }, wx: number, wz: number): [number, number] {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = wx - b.x, dz = wz - b.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** where a room of one level meets another: the stretch of the line they share, or null */
function shared(a: Room, b: Room): { x0: number; z0: number; x1: number; z1: number } | null {
  const e = 1e-3;
  if (Math.abs(a.x1 - b.x0) < e || Math.abs(a.x0 - b.x1) < e) {
    const x = Math.abs(a.x1 - b.x0) < e ? a.x1 : a.x0, z0 = Math.max(a.z0, b.z0), z1 = Math.min(a.z1, b.z1);
    return z1 - z0 > 0.9 ? { x0: x, x1: x, z0, z1 } : null;
  }
  if (Math.abs(a.z1 - b.z0) < e || Math.abs(a.z0 - b.z1) < e) {
    const z = Math.abs(a.z1 - b.z0) < e ? a.z1 : a.z0, x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1);
    return x1 - x0 > 0.9 ? { x0, x1, z0: z, z1: z } : null;
  }
  return null;
}

/** a way through, a metre wide, on the line two rooms share: at `at` along it if said (and it fits), else its middle */
function doorway(a: Room, b: Room, at?: number): Doorway | null {
  const s = shared(a, b);
  if (!s) return null;
  const along = s.x0 === s.x1, lo = along ? s.z0 : s.x0, hi = along ? s.z1 : s.x1, half = Math.min(0.5, (hi - lo) / 2 - 0.15);
  const mid = Math.min(hi - half - 0.15, Math.max(lo + half + 0.15, at ?? (lo + hi) / 2));
  return along ? { level: a.level, x0: s.x0, x1: s.x0, z0: mid - half, z1: mid + half, y: a.y } : { level: a.level, x0: mid - half, x1: mid + half, z0: s.z0, z1: s.z0, y: a.y };
}

/**
 * The rooms of a layout, in a frame where the steps are down the house's +x side (`sx0`..`sx1` across), their head at
 * z = `topZ` and their foot at z = `foot`, with a landing beyond the foot; `y1` the first level's floor. `v` is the
 * house's own dice, thrown before (so that a second try at another depth lays the same rooms).
 */
function layoutRooms(layout: Layout, W: number, sx0: number, sx1: number, foot: number, topZ: number, y1: number, v: number[]) {
  const H = CELLAR.h, y2 = y1 - H - CELLAR.slab - 0.4;
  const room = (kind: RoomKind, x0: number, x1: number, z0: number, z1: number, skin: Skin, level: 1 | 2 = 1, more: Partial<Room> = {}): Room => ({
    kind, x0, x1, z0, z1, y: level === 1 ? y1 : y2, h: H, level, ceil: true, skin, ...more,
  });
  const land = foot - CELLAR.landing;
  // the steps and their landing: a room of its own, with a floor only at the landing
  const S = room('stair', sx0, sx1, land, topZ + 0.1, 'concrete', 1, { floor: [land, foot], ceil: false });
  const rooms: Room[] = [S];
  const links: [number, number, number?][] = [];
  /** a room joined to one already laid (by its index), the way through at `at` along their line if said */
  const add = (r: Room, to: number, at?: number) => {
    rooms.push(r);
    links.push([to, rooms.length - 1, at]);
    return rooms.length - 1;
  };
  const landMid = (land + foot) / 2, wx0 = -W + 0.6;
  // (each room a little longer or shorter by the house's dice: the same layout under two houses is not the same)
  const g = (k: number, lo: number, hi: number) => lo + (hi - lo) * v[k];
  switch (layout) {
    case 'root': {
      add(room('root', wx0, sx0, land - g(0, 1.6, 2.6), land + g(1, 2.6, 3.6), 'brick'), 0, landMid);
      break;
    }
    case 'work': {
      const M = add(room('work', wx0, sx0, land - g(0, 1.2, 2.0), land + g(1, 2.4, 3.2), 'concrete'), 0, landMid);
      const m = rooms[M];
      add(room('closet', wx0, wx0 + g(2, 1.8, 2.4), m.z1, m.z1 + g(3, 1.6, 2.0), 'concrete'), M);
      add(room('store', wx0 + 2.6, Math.min(sx0, wx0 + 2.6 + g(4, 2.6, 3.4)), m.z1, m.z1 + g(5, 1.8, 2.4), 'concrete'), M);
      break;
    }
    case 'hide': {
      // a hall from the landing in under the house, a room of bunks on one side of it, a store on the other, a closet at its end
      const hx0 = -W + 1.2 - g(0, 0, 1.4);
      const Hl = add(room('hall', hx0, sx0, land, land + 1.4, 'plaster'), 0, landMid);
      const h = rooms[Hl];
      add(room('bunk', hx0, Math.min(sx0, hx0 + g(1, 3.6, 4.6)), h.z1, h.z1 + g(2, 3.0, 3.6), 'plaster'), Hl);
      add(room('store', hx0 + 0.6, sx0, h.z0 - g(3, 2.6, 3.2), h.z0, 'plaster'), Hl);
      add(room('closet', hx0 - g(4, 1.6, 2.0), hx0, h.z0 - 0.4, h.z1 + 0.4, 'plaster'), Hl);
      break;
    }
    case 'double': {
      // a cellar under the house, and from its back a passage out under the yard to a second, the better kept
      const M = add(room('root', wx0, sx0, land - g(0, 1.0, 1.6), land + g(1, 2.4, 3.2), 'brick'), 0, landMid);
      const m = rooms[M], px = g(2, -1.6, 0.4);
      const P = add(room('hall', px - 0.6, px + 0.6, m.z0 - g(3, 4.5, 6.5), m.z0, 'concrete'), M);
      const p = rooms[P];
      add(room('vault', px - g(4, 2.2, 3.0), px + g(5, 2.2, 3.0), p.z0 - g(6, 3.0, 3.8), p.z0, 'concrete'), P);
      break;
    }
    case 'deep': {
      // a workshop, and at its far end a shaft with a flight down to a second level: a vault and a closet down there
      const M = add(room('work', wx0, sx0, land - g(0, 1.0, 1.6), land + g(1, 2.8, 3.4), 'concrete'), 0, landMid);
      const m = rooms[M];
      const N2 = Math.round((y1 - y2) / CELLAR.rise), L2 = N2 * CELLAR.tread;
      const shx0 = wx0 - 1.4, shx1 = wx0, shTop = m.z1 - 1.3, shFoot = shTop - L2, shZ0 = shFoot - CELLAR.landing;
      // (on the first level the shaft has a floor only at its head; on the second it has no ceiling: the flight comes up through it)
      add(room('shaft', shx0, shx1, shZ0, m.z1, 'concrete', 1, { floor: [shTop, m.z1] }), M, m.z1 - 0.65);
      const lower = room('shaft', shx0, shx1, shZ0, m.z1, 'concrete', 2, { ceil: false });
      rooms.push(lower);
      const L = rooms.length - 1;
      add(room('vault', shx0 - g(2, 3.6, 4.6), shx0, shZ0 - g(3, 0.4, 1.2), shZ0 + g(4, 3.2, 4.0), 'concrete', 2), L, shZ0 + 0.7);
      add(room('closet', shx1, shx1 + g(5, 1.8, 2.4), shZ0, shZ0 + g(6, 1.6, 2.0), 'concrete', 2), L, shZ0 + 0.7);
      return { rooms, links, inner: [{ x0: shx0 + 0.1, x1: shx1 - 0.1, foot: shFoot, top: shTop, y0: y2, y1 }] as Flight[] };
    }
    case 'storm': {
      add(room('root', sx1, sx1 + g(0, 3.0, 3.8), land - g(1, 0.6, 1.2), land + g(2, 2.4, 3.0), 'brick'), 0, landMid);
      break;
    }
  }
  return { rooms, links, inner: [] as Flight[] };
}

/** is (x, z) on a road, or near one */
function roadNear(world: World, x: number, z: number, margin: number): boolean {
  for (const r of [world.road, ...(world.roads ?? [])]) {
    const p = r.points;
    for (let i = 0; i + 5 < p.length; i += 3) {
      const ax = p[i], az = p[i + 2], dx = p[i + 3] - ax, dz = p[i + 5] - az;
      if (Math.abs(ax - x) > 40 || Math.abs(az - z) > 40) continue;
      const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r.width / 2 + margin) return true;
    }
  }
  return false;
}

/** One house's basement of a layout, its steps down the side `mx` (1: +x) of it; null if the ground there will not have it. */
function make(world: World, plot: BuildingPlot, layout: Layout, mx: 1 | -1, v: number[], dice: RNG): Basement | null {
  const [w, d] = BUILDING_FOOTPRINT[plot.type], W = w / 2, D = d / 2, Hs = world.heights;
  const fr = { x: plot.x, z: plot.z, rot: plot.rot };
  /** the ground at a point of the frame in which the steps are down +x (mirrored to the side they are on) */
  const ground = (lx: number, lz: number) => heightAt(Hs, ...frameToWorld(fr, mx * lx, lz));
  const sx0 = layout === 'storm' ? W + 2.2 : W + 0.4, sx1 = sx0 + CELLAR.wide, topZ = D - 0.3;
  const top = Math.max(ground(sx0, topZ), ground(sx1, topZ), ground((sx0 + sx1) / 2, topZ + 0.4));
  // (under the house its foundation goes down 1.4 m under its floor: a ceiling of the cellar stays under that)
  let y1 = Math.min(top, plot.floorY) - 3.6;
  if (layout !== 'storm') y1 = Math.min(y1, plot.floorY - 1.45 - CELLAR.slab - CELLAR.h);
  let made: ReturnType<typeof layoutRooms> | null = null, foot = 0;
  for (let pass = 0; pass < 3; pass++) {
    const N = Math.round((top - y1) / CELLAR.rise);
    foot = topZ - N * CELLAR.tread;
    made = layoutRooms(layout, W, sx0, sx1, foot, topZ, y1, v);
    // the earth over every room: its ceiling is `earth` under the lowest ground over it
    let need = y1;
    for (const r of made.rooms) {
      if (r.kind === 'stair') continue;
      let low = Infinity;
      for (let x = r.x0; x <= r.x1 + 1e-6; x += Math.max(0.5, (r.x1 - r.x0) / 6)) for (let z = r.z0; z <= r.z1 + 1e-6; z += Math.max(0.5, (r.z1 - r.z0) / 6)) low = Math.min(low, ground(x, z));
      // (a room of the second level is that much deeper than the first's floor: its own ceiling is what must be under the earth)
      const deep = r.level === 1 ? 0 : y1 - r.y;
      need = Math.min(need, low - CELLAR.earth - CELLAR.slab - r.h + deep);
    }
    if (need >= y1 - 0.01) break;
    y1 = need;
  }
  if (!made || top - y1 > 6) return null;
  const { rooms, links, inner } = made;
  const N = Math.round((top - y1) / CELLAR.rise), rise = (top - y1) / N;
  const flights: Flight[] = [{ x0: sx0 + 0.1, x1: sx1 - 0.1, foot, top: topZ, y0: y1, y1: top }, ...inner];
  // the open part of the steps: down from their head as far as there is not headroom under the ground over them
  let openZ = topZ;
  for (let i = N - 1; i >= 0; i--) {
    const za = foot + i * CELLAR.tread, zb = za + CELLAR.tread, y = y1 + (i + 1) * rise;
    if (ground((sx0 + sx1) / 2, (za + zb) / 2) - y < CELLAR.headroom + 0.1) openZ = za;
    else break;
  }
  const doors: Doorway[] = [];
  for (const [a, b, at] of links) {
    const dw = doorway(rooms[a], rooms[b], at);
    if (dw) doors.push(dw);
  }
  const b: Basement = {
    plot: plot.id, type: plot.type, x: plot.x, z: plot.z, rot: plot.rot, layout, rooms, flights, doors,
    well: { x0: sx0 - 0.1, x1: sx1 + 0.1, z0: openZ - 0.05, z1: topZ + 0.02, top },
    hole: [], box: [0, 0, 0, 0], things: [], spots: [], lamps: [], better: [],
  };
  furnish(b, dice);
  // what each room is worth: the further in and the deeper, the better
  b.better = rooms.map((r) => (r.level === 2 ? 2 : r.kind === 'vault' || r.kind === 'bunk' ? 1 : 0));
  // and all of it put on the side of the house it is on
  if (mx === -1) mirror(b);
  b.hole = [[b.well.x0, b.well.z0], [b.well.x1, b.well.z0], [b.well.x1, b.well.z1], [b.well.x0, b.well.z1]].map(([x, z]) => frameToWorld(b, x, z));
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of rooms) for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) {
    const [wx, wz] = frameToWorld(b, x, z);
    x0 = Math.min(x0, wx); z0 = Math.min(z0, wz); x1 = Math.max(x1, wx); z1 = Math.max(z1, wz);
  }
  b.box = [x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3];
  return b;
}

/** the same basement on the house's other side: every x of it turned about the house's middle */
function mirror(b: Basement) {
  const flip = <T extends { x0: number; x1: number }>(r: T) => {
    const a = -r.x1, c = -r.x0;
    r.x0 = a;
    r.x1 = c;
  };
  for (const r of b.rooms) flip(r);
  for (const f of b.flights) flip(f);
  for (const d of b.doors) flip(d);
  flip(b.well);
  for (const t of b.things) {
    t.x = -t.x;
    t.rot = -t.rot;
  }
  for (const s of b.spots) s.x = -s.x;
  for (const l of b.lamps) l[0] = -l[0];
}

/**
 * What stands in each room, against its walls, and its places for things: each thing back to a wall and facing in,
 * clear of every way through (and of a metre and a half in front of it) and of what is stood already. A lamp in the
 * middle of every room's ceiling, and one over the foot of the steps.
 */
function furnish(b: Basement, dice: RNG) {
  b.rooms.forEach((r, ri) => {
    const lamp = (x: number, z: number) => b.lamps.push([x, r.y + r.h - 0.12, z]);
    if (r.kind === 'stair') {
      const f = b.flights[0];
      lamp((r.x0 + r.x1) / 2, f.foot - 0.6);
      return;
    }
    if (r.kind === 'shaft') {
      if (r.level === 2) lamp((r.x0 + r.x1) / 2, r.z0 + 0.7);
      return;
    }
    lamp((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    // (in from each wall by half its thickness, and a hair)
    const I = 0.13, X0 = r.x0 + I, X1 = r.x1 - I, Z0 = r.z0 + I, Z1 = r.z1 - I;
    const taken: [number, number, number, number][] = [];
    for (const d of b.doors) {
      if (d.level !== r.level) continue;
      // (a metre clear before each way through, and a hand either side of it: a closet was all way, and held nothing)
      if (d.x0 === d.x1 && d.x0 >= r.x0 - 1e-3 && d.x0 <= r.x1 + 1e-3) taken.push([d.x0 - 1.0, d.x0 + 1.0, d.z0 - 0.15, d.z1 + 0.15]);
      if (d.z0 === d.z1 && d.z0 >= r.z0 - 1e-3 && d.z0 <= r.z1 + 1e-3) taken.push([d.x0 - 0.15, d.x1 + 0.15, d.z0 - 1.0, d.z0 + 1.0]);
    }
    const free = (a: number, c: number, e: number, f: number) => a >= X0 - 1e-6 && c <= X1 + 1e-6 && e >= Z0 - 1e-6 && f <= Z1 + 1e-6 && !taken.some(([p, q, s, t]) => a < q && c > p && e < t && f > s);
    /** against which wall, how far along it: each wall in turn from a corner, a tenth of a metre at a time */
    const stand = (id: string): boolean => {
      const [sx, , sz, back] = SIZE[id] ?? [0.6, 0.6, 0.6, -0.3];
      const walls = [0, 1, 2, 3].sort(() => dice.next() - 0.5);
      for (const wall of walls) {
        // 0: the z0 wall (facing +z, rot 0); 1: the z1 wall (rot pi); 2: the x0 wall (facing +x); 3: the x1 wall
        const alongX = wall < 2, len = alongX ? X1 - X0 : Z1 - Z0;
        for (let u = 0.05; u + sx <= len - 0.05 + 1e-6; u += 0.1) {
          const lo = (alongX ? X0 : Z0) + u, hi = lo + sx;
          let rect: [number, number, number, number], x: number, z: number, rot: number;
          if (wall === 0) { rect = [lo, hi, Z0, Z0 + sz]; x = (lo + hi) / 2; z = Z0 - back; rot = 0; }
          else if (wall === 1) { rect = [lo, hi, Z1 - sz, Z1]; x = (lo + hi) / 2; z = Z1 + back; rot = Math.PI; }
          else if (wall === 2) { rect = [X0, X0 + sz, lo, hi]; x = X0 - back; z = (lo + hi) / 2; rot = Math.PI / 2; }
          else { rect = [X1 - sz, X1, lo, hi]; x = X1 + back; z = (lo + hi) / 2; rot = -Math.PI / 2; }
          if (!free(...rect)) continue;
          taken.push([rect[0] - 0.05, rect[1] + 0.05, rect[2] - 0.05, rect[3] + 0.05]);
          b.things.push({ id, x, z, y: r.y, rot });
          return true;
        }
      }
      return false;
    };
    for (const entry of DRESS[r.kind]) {
      const maybe = entry.startsWith('?');
      if (maybe && dice.next() < 0.5) continue;
      stand(maybe ? entry.slice(1) : entry);
    }
    // the places for things: on the floor, where nothing stands, a pace in from a wall
    let want = SPOTS[r.kind];
    for (let tries = 0; want > 0 && tries < 120; tries++) {
      const x = X0 + 0.3 + dice.next() * Math.max(0, X1 - X0 - 0.6), z = Z0 + 0.3 + dice.next() * Math.max(0, Z1 - Z0 - 0.6);
      if (!free(x - 0.25, x + 0.25, z - 0.25, z + 0.25)) continue;
      taken.push([x - 0.3, x + 0.3, z - 0.3, z + 0.3]);
      b.spots.push({ x, z, y: r.y + 0.02, floor: true, room: ri });
      want--;
    }
  });
}

/** whether the steps' opening and its kerb are clear: of buildings, things that stand about, trees and the road */
function clearWell(world: World, b: Basement): boolean {
  const pts: [number, number][] = [];
  for (let x = b.well.x0 - 0.4; x <= b.well.x1 + 0.4 + 1e-6; x += 0.35) for (let z = b.well.z0 - 0.4; z <= b.well.z1 + 0.6 + 1e-6; z += 0.35) pts.push(frameToWorld(b, x, z));
  for (const [x, z] of pts) {
    if (roadNear(world, x, z, 0.4)) return false;
    for (const o of world.buildings) {
      if (o.id === b.plot) continue;
      const [w, d] = BUILDING_FOOTPRINT[o.type], [lx, lz] = worldToFrame(o, x, z);
      if (Math.abs(lx) < w / 2 + 0.6 && Math.abs(lz) < d / 2 + 0.6) return false;
    }
  }
  const [cx, cz] = frameToWorld(b, (b.well.x0 + b.well.x1) / 2, (b.well.z0 + b.well.z1) / 2), reach = Math.hypot(b.well.x1 - b.well.x0, b.well.z1 - b.well.z0) / 2 + 1.2;
  // (what stands out of doors: a house's own furniture, stood against the inside of the wall the steps run down, is no hindrance)
  const indoors = (x: number, z: number) =>
    world.buildings.some((o) => {
      const [w, d] = BUILDING_FOOTPRINT[o.type], [lx, lz] = worldToFrame(o, x, z);
      return Math.abs(lx) < w / 2 && Math.abs(lz) < d / 2;
    });
  for (const q of world.props) if (Math.hypot(q.x - cx, q.z - cz) < reach && pts.some(([x, z]) => Math.hypot(q.x - x, q.z - z) < 0.9) && !indoors(q.x, q.z)) return false;
  for (const t of world.trees) if (Math.hypot(t.x - cx, t.z - cz) < reach + 1 && pts.some(([x, z]) => Math.hypot(t.x - x, t.z - z) < 1.3)) return false;
  return true;
}

const overlap = (a: Basement['box'], c: Basement['box']) => a[0] < c[2] && a[2] > c[0] && a[1] < c[3] && a[3] > c[1];

/**
 * Which houses have a basement, of which layout, down which side: by each house's own dice, so that it is the same
 * wherever the map is made. Said after everything else that stands on the map has been stood (see Buildings.plan).
 */
export function planBasements(world: World): Basement[] {
  const out: Basement[] = [];
  for (const plot of world.buildings) {
    const home = HOMES.has(plot.type), barn = plot.type === 'barn';
    if (!home && !barn) continue;
    const dice = new RNG((plot.seed ^ 0x5eb1a) >>> 0);
    if (!dice.chance(home ? 0.42 : 0.35)) continue;
    let layout: Layout = 'storm';
    if (home) {
      let r = dice.next() * LAYOUTS.reduce((s, [, n]) => s + n, 0);
      for (const [l, n] of LAYOUTS) if ((r -= n) <= 0) { layout = l; break; }
    }
    const v = Array.from({ length: 8 }, () => dice.next());
    const sides: (1 | -1)[] = dice.chance(0.5) ? [1, -1] : [-1, 1];
    // (a layout that will not go under this house's ground or beside it is tried smaller: a cellar of one room)
    for (const l of layout === 'storm' ? (['storm'] as Layout[]) : ([layout, 'root'] as Layout[])) {
      let done = false;
      for (const mx of sides) {
        const b = make(world, plot, l, mx, v, new RNG((plot.seed ^ 0x77c3) >>> 0));
        if (!b || !clearWell(world, b) || out.some((o) => overlap(o.box, b.box))) continue;
        out.push(b);
        done = true;
        break;
      }
      if (done) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- asked of a place, by the game and by the server

/** the basement whose box a point of the world is in (a cheap first look), or null */
function near(list: Basement[] | undefined, x: number, z: number): Basement[] {
  if (!list) return [];
  return list.filter((b) => x > b.box[0] && x < b.box[2] && z > b.box[1] && z < b.box[3]);
}

/** whether a point of the world is in a basement: in one of its rooms (from a step under its floor to its ceiling), or on its steps */
export function basementUnder(list: Basement[] | undefined, x: number, y: number, z: number): boolean {
  for (const b of near(list, x, z)) {
    const [lx, lz] = worldToFrame(b, x, z), M = 0.45;
    for (const r of b.rooms) {
      if (lx < r.x0 - M || lx > r.x1 + M || lz < r.z0 - M || lz > r.z1 + M) continue;
      if (r.kind === 'stair') {
        // (on the steps: from the slope of them up to the ground)
        if (y > r.y - 0.6 && y < b.well.top + 1) return true;
        continue;
      }
      if (y > r.y - 0.6 && y < r.y + r.h + 0.3) return true;
    }
  }
  return false;
}

/** how dark it is for being in a basement: 1 in its rooms, from 0 to that down its steps (the day comes in at their head) */
export function basementDark(list: Basement[] | undefined, x: number, y: number, z: number): number {
  if (!basementUnder(list, x, y, z)) return 0;
  for (const b of near(list, x, z)) {
    const [lx, lz] = worldToFrame(b, x, z), S = b.rooms[0];
    if (lx > S.x0 - 0.3 && lx < S.x1 + 0.3 && lz > S.z0 && lz < S.z1 + 0.3) {
      // (on the steps: as far down them as the eye is from the open sky at their head)
      const f = b.flights[0], dir = Math.sign(f.top - f.foot);
      return clamp01(((f.top - lz) * dir - 0.4) / 3.2) * 0.9;
    }
  }
  return 1;
}

/** whether a point of the world is over the open steps of a basement, where the ground is not */
export function inWell(list: Basement[] | undefined, x: number, z: number, margin = 0): boolean {
  for (const b of near(list, x, z)) {
    const [lx, lz] = worldToFrame(b, x, z), w = b.well;
    if (lx > w.x0 - margin && lx < w.x1 + margin && lz > w.z0 - margin && lz < w.z1 + margin) return true;
  }
  return false;
}

/** whether a point is in a basement's second level, where what is kept is the best kept anywhere under a house */
export function basementDeep(list: Basement[] | undefined, x: number, y: number, z: number): boolean {
  for (const b of near(list, x, z)) {
    const [lx, lz] = worldToFrame(b, x, z);
    for (const r of b.rooms) if (r.level === 2 && lx > r.x0 && lx < r.x1 && lz > r.z0 && lz < r.z1 && y > r.y - 0.5 && y < r.y + r.h) return true;
  }
  return false;
}
