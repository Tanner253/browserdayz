// A room shut in stone (2026-10-24). The owner: "light should not be seen outside an enclosed stone+ base that
// originates within". A light in a room whose every wall, floor and roof is stone or metal, its doors and hatches shut
// and its windows shuttered, is seen by nobody outside it. The room is found on its base's square grid: the cells
// joined to the light's with no wall between, each with a floor under it and a floor or a roof over it (or stairs up
// into the storey above, which is then the room too), every edge out of it a whole wall. Anything else, a triangle, a
// half wall, a frame, bars, an open door, and it is not shut: its light shows, as every light did.

import { CELL, PIECES, STOREY } from './pieces';
import { toLocal, type Base, type Piece } from './snap';
import { shapeOf } from './solids';

/** the least tier a shut room's shell is: stone */
const STONE = 2;
/** a room of more cells than this is not looked through: a base that big lets its light out */
const MOST = 32;

/** a room shut all round: its base, and each of its cells as 'i,j,storey's floor height' */
export interface Room {
  b: number;
  cells: Set<string>;
}

/** the pieces of a base on its square grid: floors by cell and height, walls by edge and height, fittings by what they hang on */
function gridOf(b: Base) {
  const floors = new Map<string, Piece>(), walls = new Map<string, Piece>(), fits = new Map<number, Piece>(), stairs = new Set<string>();
  const on = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) < 0.02;
  for (const p of b.pieces.values()) {
    const K = PIECES[p.k];
    if (K.role === 'fit') {
      for (const w of p.on) fits.set(w, p);
      continue;
    }
    const y = Math.round(p.y * 10) / 10;
    if (K.role === 'floor' && K.shape === 'sq' && on(p.x, CELL) && on(p.z, CELL)) floors.set(`${Math.round(p.x / CELL)},${Math.round(p.z / CELL)},${y}`, p);
    else if (K.role === 'stairs' && on(p.x, CELL) && on(p.z, CELL)) stairs.add(`${Math.round(p.x / CELL)},${Math.round(p.z / CELL)},${y}`);
    else if (K.role === 'wall' && on(p.x, CELL / 2) && on(p.z, CELL / 2)) walls.set(`${Math.round(p.x / (CELL / 2))},${Math.round(p.z / (CELL / 2))},${y}`, p);
  }
  return { floors, walls, fits, stairs };
}

/** a fitting that closes its opening: one that swings (a door, a hatch, shutters), swung shut */
const closes = (fit: Piece | undefined) => !!fit && !!shapeOf(fit.k).leaves?.length && !fit.open;

/**
 * The room of base `b` a place (in the world) is shut in, all round in stone or metal, every way out of it shut. Null:
 * it is in no room, or in one that is not so shut.
 */
export function shutRoom(b: Base, x: number, y: number, z: number): Room | null {
  const [lx, ly, lz] = toLocal(b, x, y, z);
  const g = gridOf(b), i0 = Math.round(lx / CELL), j0 = Math.round(lz / CELL);
  // (its storey: the highest floor of its cell at its height or under, a storey at most)
  let level: number | null = null;
  for (const [k, p] of g.floors) {
    const [i, j, h] = k.split(',').map(Number);
    if (i === i0 && j === j0 && !PIECES[p.k].roof && h <= ly + 0.3 && h > ly - STOREY && (level === null || h > level)) level = h;
  }
  if (level === null) return null;
  const tier = (p: Piece) => p.t >= STONE;
  const cells = new Set<string>(), todo: [number, number, number, boolean][] = [[i0, j0, level, false]];
  while (todo.length) {
    const [i, j, h, fromBelow] = todo.pop()!;
    const key = `${i},${j},${h}`;
    if (cells.has(key)) continue;
    if (cells.size >= MOST) return null;
    cells.add(key);
    // (a floor under it, whole or its hatch shut; unless it is the storey a stair came up into)
    const under = g.floors.get(key);
    if (!fromBelow) {
      if (!under || PIECES[under.k].roof || !tier(under)) return null;
      if (PIECES[under.k].hole && !closes(g.fits.get(under.id))) return null;
    }
    // (over it a floor or a roof, whole or its hatch shut; or stairs up, and the storey over is the room too)
    const over = g.floors.get(`${i},${j},${Math.round((h + STOREY) * 10) / 10}`);
    if (g.stairs.has(key) && !over) todo.push([i, j, Math.round((h + STOREY) * 10) / 10, true]);
    else {
      if (!over || !tier(over)) return null;
      if (PIECES[over.k].hole && !closes(g.fits.get(over.id))) return null;
    }
    // (and every edge out of it: a whole wall, a doorway, window or frame shut; or no wall, and the room goes on)
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const wall = g.walls.get(`${2 * i + di},${2 * j + dj},${h}`);
      if (!wall) {
        todo.push([i + di, j + dj, h, false]);
        continue;
      }
      const W = PIECES[wall.k];
      if (!tier(wall) || (W.h ?? STOREY) < STOREY) return null;
      if (W.hole && !closes(g.fits.get(wall.id))) return null;
    }
  }
  return { b: b.id, cells };
}

/** whether a place is in a room (the cell and storey it stands in, on its base's grid) */
export function inRoom(room: Room, b: Base, x: number, y: number, z: number) {
  if (b.id !== room.b) return false;
  const [lx, ly, lz] = toLocal(b, x, y, z), i = Math.round(lx / CELL), j = Math.round(lz / CELL);
  for (const k of room.cells) {
    const [ci, cj, h] = k.split(',').map(Number);
    if (ci === i && cj === j && ly >= h - 0.3 && ly < h + STOREY + 0.2) return true;
  }
  return false;
}
