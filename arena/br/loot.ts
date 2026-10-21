// What is found in a battle royale, and where (2026-10-21): the open world's own places for things (every shelf,
// table and floor the game's buildings have, Kalat's ruins and the pass's caves), planned as the game server plans them
// (server/world.ts) but once, by scripts/br-solids.ts, into arena/br/solids/spots.bin.gz: planning every building costs
// a server some 250 MB, the places themselves 70 KB. Plus caches in the open, Fortnite's floor loot, so the desert, with
// few buildings, has its share. A place's step on the map (1 to 5) leans what is there toward its
// rarity. Each gun lies with two boxes of its rounds (Fortnite's way: nobody finds a gun with nothing to put in it).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ITEMS, makeItem } from '../../src/sim/items';
import { heightAt, type World } from '../../src/world/worldgen';
import { AMMO, GUNS, HEALS, HELMETS, MAPS, PACKS, VESTS, freshGun, inMap, type BrMap, type Ground } from './rules';

export interface Spot { x: number; y: number; z: number; tier: number }

const SPOTS = 'arena/br/solids/spots.bin.gz';

/** every place for a thing on every map, with its step, as baked (four floats each: x y z step) */
export function brSpots(): Spot[] {
  const file = path.join(process.cwd(), SPOTS);
  if (!existsSync(file)) return [];
  const b = gunzipSync(readFileSync(file)), f = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), out: Spot[] = [];
  for (let i = 0; i < f.length; i += 4) out.push({ x: f[i], y: f[i + 1], z: f[i + 2], tier: f[i + 3] });
  return out;
}

/** the places, written as `brSpots` reads them (by scripts/br-solids.ts) */
export const spotsFile = (spots: Spot[]) => gzipSync(Buffer.from(new Float32Array(spots.flatMap((s) => [s.x, s.y, s.z, s.tier])).buffer), { level: 9 });
export const SPOTS_FILE = SPOTS;

const pick = <T>(a: readonly T[], rnd: () => number) => a[Math.floor(rnd() * a.length)];
const clampT = (t: number) => Math.max(1, Math.min(5, Math.round(t)));

/** a rarity for a place of a step: mostly its own, sometimes one either side; the gold kept rare */
function rarityAt(tier: number, rnd: () => number): number {
  let r = clampT(tier + pick([-1, 0, 0, 0, 1], rnd));
  if (r === 5 && rnd() < 0.55) r = 4;
  return r;
}

const ammoOf = (gun: string) => ITEMS[gun].weapon!.ammo;

/** one find at a place: what it is, and anything that lies with it */
function finds(r: number, rnd: () => number): { item?: ReturnType<typeof makeItem>; ammo?: string; n?: number }[] {
  const roll = rnd();
  if (roll < 0.42) {
    const g = pick(GUNS[r] ?? GUNS[1], rnd), a = ammoOf(g);
    return [{ item: freshGun(g) }, { ammo: a, n: AMMO[a]?.box ?? 30 }, { ammo: a, n: AMMO[a]?.box ?? 30 }];
  }
  if (roll < 0.64) {
    const heals = Object.entries(HEALS).filter(([, h]) => Math.abs(h.tier - r) <= 1);
    const [id, h] = pick(heals.length ? heals : Object.entries(HEALS), rnd);
    return [{ item: makeItem(id, Math.min(h.stack, 1 + Math.floor(rnd() * 2))) }];
  }
  if (roll < 0.7) return [{ item: makeItem(r >= 3 ? 'frag' : 'grenade', 1 + Math.floor(rnd() * 2)) }];
  if (roll < 0.82) {
    const a = pick(Object.keys(AMMO).filter((k) => k !== 'ammo_50bmg' || r >= 4), rnd);
    return [{ ammo: a, n: AMMO[a].box }];
  }
  if (roll < 0.88) return [{ item: makeItem(VESTS[r]) }];
  if (roll < 0.94) return [{ item: makeItem(HELMETS[r]) }];
  return [{ item: makeItem(PACKS[Math.min(3, r)]) }];
}

let nextId = 1;
/** a find laid at a place, its pieces a hand's breadth apart */
function lay(out: Ground[], x: number, y: number, z: number, r: number, rnd: () => number) {
  finds(r, rnd).forEach((f, k) => {
    const a = k * 2.1, d = k ? 0.38 : 0;
    out.push({ id: nextId++, x: x + Math.cos(a) * d, y, z: z + Math.sin(a) * d, ...f });
  });
}

/** places in the open a body can stand on: land, not steep, not the sea */
function openSpots(world: World, m: BrMap, n: number, rnd: () => number): Spot[] {
  const out: Spot[] = [];
  const g = (x: number, z: number) => heightAt(world.heights, x, z);
  for (let k = 0; k < n * 6 && out.length < n; k++) {
    const x = m.x0 + 30 + rnd() * (m.x1 - m.x0 - 60), z = m.z0 + 30 + rnd() * (m.z1 - m.z0 - 60), y = g(x, z);
    if (y < -14 || Math.abs(g(x + 2, z) - y) > 1.2 || Math.abs(g(x, z + 2) - y) > 1.2) continue;
    out.push({ x, y: y + 0.02, z, tier: 1 + Math.floor(rnd() * 3) });
  }
  return out;
}

/** a match's things on the ground, on its map: a share of the places filled, and the caches in the open */
export function rollMatch(world: World, spots: Spot[], map: number, rnd: () => number): Ground[] {
  const m = MAPS[map], out: Ground[] = [];
  const here = spots.filter((s) => inMap(m, s.x, s.z, -4));
  // (the desert has a third of the middle's buildings and a quarter of the village's: more of its places filled, and more in the open)
  const share = here.length < 400 ? 0.75 : here.length < 900 ? 0.55 : 0.4;
  for (const s of here) if (rnd() < share) lay(out, s.x, s.y, s.z, rarityAt(s.tier, rnd), rnd);
  for (const s of openSpots(world, m, here.length < 400 ? 160 : 70, rnd)) lay(out, s.x, s.y, s.z, rarityAt(s.tier, rnd), rnd);
  return out;
}

/** the waiting area's guns: anything up to purple, each with its rounds, round the ring */
export function rollWait(world: World, map: number, rnd: () => number): Ground[] {
  const w = MAPS[map].wait, out: Ground[] = [];
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2 + rnd() * 0.2, d = w.r * (0.25 + 0.6 * rnd()), x = w.x + Math.cos(a) * d, z = w.z + Math.sin(a) * d;
    const g = pick(GUNS[1 + Math.floor(rnd() * 4)], rnd), am = ammoOf(g), y = heightAt(world.heights, x, z) + 0.02;
    out.push({ id: nextId++, x, y, z, item: freshGun(g) }, { id: nextId++, x: x + 0.4, y, z, ammo: am, n: AMMO[am]?.box ?? 30 }, { id: nextId++, x: x - 0.4, y, z, ammo: am, n: AMMO[am]?.box ?? 30 });
  }
  return out;
}

/** a new number for a thing put down (dropped, or spilled from the fallen) */
export const groundId = () => nextId++;
