// The ground as the animals know it (2026-10-23): what kind of country a place is (field, forest, rock, snow, desert,
// water, a town), whether an animal can stand there, and whether it can see from one place to another. Made from the
// same world the game draws, on the server, which moves every animal (src/sim/animal-mind.ts).
//
// Worked out a patch at a time as it is first asked about and kept (most of the map is never asked: animals keep to
// their own ground), so the server starts no slower for it.

import { BUILDING_FOOTPRINT, heightAt, onWorld, SEA_LEVEL, WORLD_X0, WORLD_X1, WORLD_Z0, WORLD_Z1, WORLD_NX, CELL, type World } from '../world/worldgen';
import { snowOn } from '../world/snow';
import { waterAt } from './water';
import type { Biome } from './animals';

/** What the animals ask of the ground. A test hands in one of its own. */
export interface Ground {
  height(x: number, z: number): number;
  /** rise over run where it stands */
  slope(x: number, z: number): number;
  biome(x: number, z: number): Biome;
  /** whether an animal can stand there: not in water, a building, a trunk or a rock, and no steeper than it climbs */
  open(x: number, z: number, steep: number): boolean;
  /** under a roof: inside a building, where no animal can follow */
  roofed(x: number, z: number): boolean;
  /** how thick the trees are about a place, 0 to 1 (it hides whoever is in it) */
  cover(x: number, z: number): number;
  /** whether the ground between two eyes is clear (a hill between hides one from the other) */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  /** water to drink from within `r` of a place: its edge, on dry ground */
  water(x: number, z: number, r: number): { x: number; z: number } | null;
  /** the yards of the farms, where the farm's animals live */
  farms: { x: number; z: number; r: number; name: string }[];
  /** where the map's own ground is, to choose herds' ground in */
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

const BIOMES: Biome[] = ['field', 'forest', 'rock', 'snow', 'desert', 'water', 'town'];
/** metres a side of the cells kinds of country are kept in, and of the patches they are worked out in */
const B = 4, TILE = 32;
/** a bin of what stands on the ground (trunks, rocks, buildings), metres */
const BIN = 16;

export function animalGround(world: World): Ground {
  const ground = (x: number, z: number) => heightAt(world.heights, x, z);
  const NX = Math.ceil((WORLD_X1 - WORLD_X0) / B), NZ = Math.ceil((WORLD_Z1 - WORLD_Z0) / B);
  // kinds of country, one byte a cell: 255 until its patch is worked out
  const kinds = new Uint8Array(NX * NZ).fill(255);
  // trees counted in 24 m bins, as the map of the plan does (six and more is forest)
  const TB = 24, TBX = Math.ceil((WORLD_X1 - WORLD_X0) / TB), TBZ = Math.ceil((WORLD_Z1 - WORLD_Z0) / TB);
  const treeBins = new Uint16Array(TBX * TBZ);
  const tbin = (x: number, z: number) => Math.min(TBZ - 1, Math.max(0, Math.floor((z - WORLD_Z0) / TB))) * TBX + Math.min(TBX - 1, Math.max(0, Math.floor((x - WORLD_X0) / TB)));
  for (const t of world.trees) treeBins[tbin(t.x, t.z)]++;
  // what stands in the way, by bins
  const BX = Math.ceil((WORLD_X1 - WORLD_X0) / BIN), BZ = Math.ceil((WORLD_Z1 - WORLD_Z0) / BIN);
  const bins = new Map<number, Solid[]>();
  const binOf = (x: number, z: number) => Math.min(BZ - 1, Math.max(0, Math.floor((z - WORLD_Z0) / BIN))) * BX + Math.min(BX - 1, Math.max(0, Math.floor((x - WORLD_X0) / BIN)));
  const put = (s: Solid) => {
    const r = s.r;
    for (let x = s.x - r; x <= s.x + r + BIN; x += BIN) for (let z = s.z - r; z <= s.z + r + BIN; z += BIN) {
      if (x > s.x + r || z > s.z + r) continue;
      const k = binOf(x, z);
      const l = bins.get(k) ?? [];
      if (!l.includes(s)) l.push(s);
      bins.set(k, l);
    }
  };
  for (const t of world.trees) put({ x: t.x, z: t.z, r: 0.45 * Math.max(0.6, t.scale), c: 1, s: 0 });
  for (const r of world.rocks) put({ x: r.x, z: r.z, r: Math.min(4, 0.9 * r.scale), c: 1, s: 0 });
  for (const b of world.buildings) {
    const f = BUILDING_FOOTPRINT[b.type];
    if (!f) continue;
    const [w, d] = f;
    put({ x: b.x, z: b.z, r: Math.hypot(w, d) / 2 + 1, c: Math.cos(b.rot), s: Math.sin(b.rot), w: w / 2 + 0.8, d: d / 2 + 0.8, house: true });
  }
  for (const w of world.walls) {
    const c = Math.cos(w.yaw), s = Math.sin(w.yaw);
    // (a length runs along its own x: src/world/gatehouse.ts, drystoneBoxes)
    put({ x: w.x, z: w.z, r: w.long / 2 + 1, c, s, w: w.long / 2 + 0.4, d: w.thick / 2 + 0.4 });
  }
  const towns = world.pois.map((p) => ({ x: p.x, z: p.z, r: p.radius, farm: /farm|kolkhoz/i.test(p.name), name: p.name }));

  const slope = (x: number, z: number) => {
    const h = ground(x, z);
    return Math.hypot(ground(x + 1.5, z) - h, ground(x, z + 1.5) - h) / 1.5;
  };
  const wet = (x: number, z: number) => ground(x, z) < SEA_LEVEL + 0.4 || (!!world.water && !!waterAt(world.water, x, z, ground));
  const kindAt = (x: number, z: number): Biome => {
    if (!onWorld(x, z, -4)) return 'water';
    if (wet(x, z)) return 'water';
    if (towns.some((t) => Math.hypot(t.x - x, t.z - z) < t.r)) return 'town';
    const h = ground(x, z);
    if (snowOn(world as never, x, h, z) > 0.45) return 'snow';
    const ix = Math.round((x - WORLD_X0) / CELL), iz = Math.round((z - WORLD_Z0) / CELL);
    if (world.sand && world.sand[(iz * WORLD_NX + ix) * 4] > 120) return slope(x, z) > 0.9 ? 'rock' : 'desert';
    if (slope(x, z) > 0.9) return 'rock';
    return treeBins[tbin(x, z)] >= 6 ? 'forest' : 'field';
  };
  const work = (tx: number, tz: number) => {
    for (let j = tz * TILE; j < Math.min(NZ, (tz + 1) * TILE); j++) for (let i = tx * TILE; i < Math.min(NX, (tx + 1) * TILE); i++) {
      kinds[j * NX + i] = BIOMES.indexOf(kindAt(WORLD_X0 + (i + 0.5) * B, WORLD_Z0 + (j + 0.5) * B));
    }
  };
  const biome = (x: number, z: number): Biome => {
    const i = Math.floor((x - WORLD_X0) / B), j = Math.floor((z - WORLD_Z0) / B);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return 'water';
    if (kinds[j * NX + i] === 255) work(Math.floor(i / TILE), Math.floor(j / TILE));
    return BIOMES[kinds[j * NX + i]];
  };
  const inSolid = (x: number, z: number, houses = false) => {
    for (const s of bins.get(binOf(x, z)) ?? []) {
      if (houses && !s.house) continue;
      const dx = x - s.x, dz = z - s.z;
      if (s.w === undefined) {
        if (dx * dx + dz * dz < s.r * s.r) return true;
        continue;
      }
      if (dx * dx + dz * dz > s.r * s.r) continue;
      // (turned into the thing's own frame: across it, and along it)
      const a = dx * s.c - dz * s.s, b = dx * s.s + dz * s.c;
      if (Math.abs(a) < s.w && Math.abs(b) < s.d!) return true;
    }
    return false;
  };
  return {
    height: ground,
    slope,
    biome,
    open: (x, z, steep) => onWorld(x, z, -6) && !wet(x, z) && slope(x, z) <= steep && !inSolid(x, z),
    roofed: (x, z) => inSolid(x, z, true),
    cover: (x, z) => Math.min(1, treeBins[tbin(x, z)] / 14),
    clear: (ax, ay, az, bx, by, bz) => {
      const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 4);
      for (let k = 1; k < n; k++) {
        const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (ground(x, z) > ay + (by - ay) * t - 0.2) return false;
      }
      return true;
    },
    water: (x, z, r) => {
      if (!world.water) return null;
      for (let k = 0; k < 40; k++) {
        const a = (k * 2.39996) % (Math.PI * 2), d = r * Math.sqrt((k + 0.5) / 40);
        const wx = x + Math.cos(a) * d, wz = z + Math.sin(a) * d;
        if (!waterAt(world.water, wx, wz, ground)) continue;
        // (the dry edge: walked back toward where it was asked from until the water ends)
        for (let s = 1; s <= 12; s++) {
          const ex = wx + (x - wx) * (s / 12), ez = wz + (z - wz) * (s / 12);
          if (!wet(ex, ez)) return { x: ex, z: ez };
        }
      }
      return null;
    },
    farms: towns.filter((t) => t.farm).map(({ x, z, r, name }) => ({ x, z, r, name })),
    bounds: { x0: WORLD_X0, x1: WORLD_X1, z0: WORLD_Z0, z1: WORLD_Z1 },
  };
}

/** something in the way: a round one (`w` unsaid), or a box turned by `c`, `s` with half-sizes `w` across and `d` along */
interface Solid {
  x: number;
  z: number;
  r: number;
  c: number;
  s: number;
  w?: number;
  d?: number;
  /** a building (a roof to be under) */
  house?: boolean;
}
