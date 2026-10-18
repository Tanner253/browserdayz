// What can be searched, in one place: every model that holds things (a crate, a locker, a cabinet, a desk...), what
// it is called, how big its grid is, and where what is in it comes from. The owner, 2026-10-17: "make all furniture
// have storage by default like the bunker has", "OOP is best and look at how dayz does it themselves", and "we should
// do it for all furniture with containers, bed doesnt make sense".
//
// As DayZ has it: a thing that holds things is an entity with cargo. What its cargo is comes one of two ways (`Cargo`):
//  - 'economy': it holds what the economy puts on the places for loot that are on it or in it (`LootPoint.inside`),
//    under the same rules as everything else on the map (tier, kind of building, counts, lifetime, restock). The
//    things are the economy's, counted on the map as DayZ counts cargo it is told to (`count_in_cargo`); they are
//    not drawn, and are seen when it is opened. What a player leaves in it is its own.
//  - a table: it is filled from a list of its own when it stands empty (the crates: `fillCrate` in crates.ts).
// Open things (shelves, racks, beds, tables) are not here: what lies on them is drawn there, as in DayZ.
//
// To make a new model searchable, add it to FURNITURE. Nothing else has to be told.

import { crateId } from '../net/protocol';

/** where a thing's cargo comes from (see the head of this file) */
export type Cargo = 'economy' | 'table';

export interface StorageDef {
  /** what it is called when it is opened */
  label: string;
  /** its grid, cells across and down */
  grid: [number, number];
  cargo: Cargo;
}

/**
 * The furniture that holds the loot of its own places (2026-10-17). Every one on the map is searchable, whether the
 * economy has a place on it or not: what a player leaves in it is kept.
 */
export const FURNITURE: Record<string, StorageDef> = {
  painted_wooden_cabinet: { label: 'Cabinet', grid: [6, 4], cargo: 'economy' },
  metal_office_desk: { label: 'Desk', grid: [6, 3], cargo: 'economy' },
  hospital_desk: { label: 'Desk', grid: [6, 3], cargo: 'economy' },
  lab_counter: { label: 'Counter', grid: [6, 4], cargo: 'economy' },
  electric_stove: { label: 'Stove', grid: [4, 3], cargo: 'economy' },
  surgical_trolley: { label: 'Trolley', grid: [4, 3], cargo: 'economy' },
  barrel_03: { label: 'Barrel', grid: [5, 5], cargo: 'economy' },
  Barrel_01: { label: 'Barrel', grid: [5, 5], cargo: 'economy' },
  // (two with no places of their own: a thing or two each from a list, as DayZ's cargo presets fill a container)
  cardboard_box_01: { label: 'Cardboard Box', grid: [4, 3], cargo: 'table' },
  crate_big: { label: 'Large Crate', grid: [8, 4], cargo: 'table' },
};

/** the furniture whose cargo is the economy's */
export const economyCargo = (kind: string) => FURNITURE[kind]?.cargo === 'economy';

/** props that are searched as crates (loot is inside, never lying on top): their tables in crates.ts */
export const CRATE_KINDS = new Set(['wooden_crate_01', 'wooden_military_crate', 'old_military_crate', 'weapons_case']);
/**
 * Furniture that is searched as a crate is, filled from a table by where it stands (2026-10-12: "the metal lockers found
 * in the police station and the medical station should be lootable and have inventories"): the steel cabinet with two
 * doors of the headquarters and the hospital, and the steel locker (two in one case, whose doors swing: HUNG in
 * crates.ts). A crate has no place for a thing on it, and these are asked nothing of where places are.
 */
export const SEARCHED_KINDS = new Set(['med_cabinet', 'steel_locker', 'gun_rack']);

/** whether a model is searched: a crate, a locker, or furniture that holds things. Every part of the game asks this. */
export const isSearchable = (kind: string) => CRATE_KINDS.has(kind) || SEARCHED_KINDS.has(kind) || !!FURNITURE[kind];

/**
 * Which of a piece's places for loot are in it and which stay on top of it, drawn (the owner: "we should still render
 * some loot on ... even the containers with loot in them if it looks good, like rust or dayz does"). A piece with three
 * places or more keeps one on top; the rest, and every place of a smaller piece, are in it.
 * @param places how many places the piece has; @param i which of them (in the order they were made)
 */
export const placeInside = (places: number, i: number) => !(places >= 3 && i === places - 1);

/** a model's own name, without what the world adds to it (`#...` a variant, `@...` a paint) */
export const baseKind = (kind: string) => kind.split(/[#@]/)[0];

/**
 * What a piece of furniture is known by, on the server and in every game alike: where it stands, height and all (two
 * cardboard boxes stand one on the other). A crate's or a locker's is `crateId`, as it always was.
 */
export const furnitureId = (x: number, y: number, z: number) => `furn_${Math.round(x * 10)}_${Math.round(y * 10)}_${Math.round(z * 10)}`;

/** a searchable thing's id by what it is and where it stands: furniture's, or a crate's */
export const storageId = (kind: string, x: number, y: number, z: number) => (FURNITURE[baseKind(kind)] ? furnitureId(x, y, z) : crateId(x, z));

/**
 * Marks the places for loot that are inside a piece of furniture whose cargo is the economy's (`inside`: its id). A
 * place is the piece's when the middle of the surface it lies on is the piece's middle, within 0.7 m across and from
 * the piece's foot to 2.5 m over it; of a piece's places, those `placeInside` says.
 */
export function markInside(points: { x: number; y: number; z: number; surf?: { x: number; z: number }; inside?: string }[], props: { kind: string; x: number; y: number; z: number }[]) {
  const pieces = props.filter((q) => economyCargo(baseKind(q.kind)));
  const cells = new Map<string, typeof pieces>();
  const cell = (x: number, z: number) => `${Math.floor(x / 2)}_${Math.floor(z / 2)}`;
  for (const q of pieces) (cells.get(cell(q.x, q.z)) ?? cells.set(cell(q.x, q.z), []).get(cell(q.x, q.z))!).push(q);
  const of = new Map<(typeof pieces)[number], typeof points>();
  for (const p of points) {
    if (!p.surf) continue;
    let best: (typeof pieces)[number] | null = null, near = 0.7;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const q of cells.get(`${Math.floor(p.surf.x / 2) + dx}_${Math.floor(p.surf.z / 2) + dz}`) ?? []) {
      const d = Math.hypot(q.x - p.surf.x, q.z - p.surf.z);
      if (d < near && p.y >= q.y - 0.1 && p.y <= q.y + 2.5) [best, near] = [q, d];
    }
    if (best) (of.get(best) ?? of.set(best, []).get(best)!).push(p);
  }
  for (const [q, list] of of) list.forEach((p, i) => {
    if (placeInside(list.length, i)) p.inside = furnitureId(q.x, q.y, q.z);
  });
}
