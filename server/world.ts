// The server builds the same world the clients do, from the same code and seed, so
// loot points, crates, doors and spawn points line up exactly without sending the map.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { bunkerPlace, generateWorld, heightAt } from '../src/world/worldgen';
import { BUNKER, bunkerAt, bunkerCrates, levelY } from '../src/sim/bunker';
import { Buildings, CRATE_KINDS, SEARCHED_KINDS } from '../src/world/buildings';
import { assets } from '../src/core/assets';
import { crateId } from '../src/net/protocol';
import { callSite, pickDropSite } from '../src/sim/drops';
import { barrelSpots } from '../src/sim/barrels';
import { JEEP, POLICE_CAR, jeepSpots, policeSpots } from '../src/sim/vehicles';
import { HELI, heliSpots } from '../src/sim/heli';
import { homeSpot, infectedHomes, type Home } from '../src/sim/infected';
import { fireSpots } from '../src/sim/fires';
import { gasZone } from '../src/sim/gas';
import { standAt } from '../src/sim/bridge';
import { castleUnder, inCastle } from '../src/sim/castle';
import { basementDeep, basementUnder } from '../src/sim/basements';
import { BUILDING_FOOTPRINT } from '../src/world/worldgen/layout';

export interface CrateSpot {
  cid: string;
  kind: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Whatever a body could be up on, near a place (2026-10-15: bots "walking in the air"): every building (its stairs,
 * its roof, its ladder), rock, tank, wall, crate, prop and the wreck, each as a ring of its reach and four metres more
 * round its middle, kept in squares of 16 m. Whoever is within one of those rings may be standing on it, and is not
 * asked how they are up off the ground. (Vehicles move: they are asked of separately.)
 */
function supports(world: ReturnType<typeof generateWorld>, crates: { x: number; z: number }[]) {
  const CELL = 16, cells = new Map<string, [number, number, number][]>();
  const add = (x: number, z: number, r: number) => {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const k = `${cx},${cz}`;
        (cells.get(k) ?? cells.set(k, []).get(k)!).push([x, z, r]);
      }
  };
  const REACH = 4;
  for (const b of world.buildings) {
    const [w, d] = BUILDING_FOOTPRINT[b.type] ?? [12, 12];
    add(b.x, b.z, Math.hypot(w, d) / 2 + REACH);
  }
  for (const r of world.rocks) add(r.x, r.z, 2.5 * Math.max(1, r.scale) + REACH);
  for (const s of world.solids) add(s.x, s.z, s.r + REACH);
  // (a wall as a ring round its middle that takes in its whole length: more than it reaches, never less)
  for (const w of world.walls) add(w.x, w.z, w.long / 2 + REACH);
  for (const p of world.props) add(p.x, p.z, 1 + REACH);
  for (const c of crates) add(c.x, c.z, 1.5 + REACH);
  if (world.wreck) add(world.wreck.x, world.wreck.z, 3 + REACH);
  return (x: number, z: number) => (cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []).some(([px, pz, r]) => (px - x) ** 2 + (pz - z) ** 2 <= r * r);
}

export function buildWorldData(root: string) {
  // (the newer of the built copy and the one in public/: the same after a build, and on a machine whose last build is
  // older than the last model brought in, that model's things are not left out: 2026-10-14, the helicopters)
  const manifestPath = [path.join(root, 'dist/assets/manifest.json'), path.join(root, 'public/assets/manifest.json')].filter((p) => existsSync(p)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!manifestPath) throw new Error('assets manifest not found (run the client build first)');
  // furniture sizes come from the model manifest; nothing is downloaded or rendered here
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { models?: Record<string, unknown> };
  (assets as { manifest: unknown }).manifest = manifest;
  const world = generateWorld();
  const buildings = new Buildings(world, null as never);
  buildings.plan();
  const crates: CrateSpot[] = world.props
    .map((p) => ({ p, kind: p.kind.split(/[#@]/)[0] }))
    .filter(({ kind }) => CRATE_KINDS.has(kind) || SEARCHED_KINDS.has(kind))
    .map(({ p, kind }) => ({ cid: crateId(p.x, p.z), kind, x: p.x, y: p.y, z: p.z }));
  // (and what is searched in the bunker that is no crate: its lockers, racks, cabinets and desks)
  const under = bunkerPlace(world);
  if (under) for (const c of bunkerCrates(under)) crates.push({ cid: crateId(c.x, c.z), kind: c.kind, x: c.x, y: c.y, z: c.z });
  return {
    lootPoints: buildings.lootPoints,
    /** where every building stands, and how it is turned (nothing is buried under a floor) */
    buildings: world.buildings.map((q) => ({ type: q.type, x: q.x, z: q.z, rot: q.rot })),
    /** the towns, camps and other named places, each as far round as it reaches (nothing is buried in one) */
    places: world.pois.map((q) => ({ x: q.x, z: q.z, radius: q.radius })),
    crates,
    /** where the bunker stands (null: the world has none) */
    bunker: bunkerPlace(world),
    /** the middle of the bunker's door, which a keycard is held up to (null: the world has no bunker) */
    bunkerDoor: (() => {
      const at = bunkerPlace(world);
      return at ? bunkerAt(at, 0, BUNKER.hall.front, levelY() + 1.2) : null;
    })(),
    /** where the gas lies (a crate under it is filled with the best of everything) */
    gas: gasZone(world.pois, (x, z) => heightAt(world.heights, x, z)),
    /** the fuel drums, numbered as the game numbers them */
    barrels: barrelSpots(world.props).map((p) => ({ x: p.x, y: p.y, z: p.z })),
    /** the fireplaces, numbered as the game numbers them */
    fires: fireSpots(world.props).map((p) => ({ x: p.x, y: p.y, z: p.z })),
    /** where the jeeps stand to begin with: none, for as long as the game has no model to draw one with */
    jeeps: manifest.models?.[JEEP.model] || process.env.JEEPS === 'on' ? jeepSpots(world) : [],
    /** and the police cars, one beside each police station: none without the jeeps, or without a model of their own */
    cars: manifest.models?.[JEEP.model] && manifest.models?.[POLICE_CAR.model] ? policeSpots(world, jeepSpots(world)) : [],
    /** and the helicopters (src/sim/heli.ts): on the hospital's roof and by the fort; none without the jeeps, or without a model of their own */
    helis: manifest.models?.[JEEP.model] && manifest.models?.[HELI.model] ? heliSpots(world) : [],
    spawns: world.spawns,
    /** where the infected live, and somewhere to stand one about such a place (see src/sim/infected.ts) */
    homes: infectedHomes(world),
    homeSpot: (h: Home) => homeSpot(world, h, Math.random),
    doorCount: buildings.doorSpecs.length,
    groundAt: (x: number, z: number) => heightAt(world.heights, x, z),
    /**
     * The top of the earth at a place: the ground, or where the ground is cut down for the fort's passage and earth
     * is laid back over it, that earth (`surface`). It is what somebody who may be UNDER the ground is asked about:
     * by the ground alone, which there is the bottom of the cut, a body in the earth between the passage's roof and
     * the lid was never under anything.
     */
    coverAt: (x: number, z: number) => Math.max(heightAt(world.heights, x, z), heightAt(world.surface, x, z)),
    /**
     * What somebody at a place has under them to stand on: the ground, or the deck of a bridge for whoever is on
     * one (see src/sim/bridge.ts). Asked wherever it is a question of somebody being in the air: `groundAt` is the
     * ground alone, and is what is asked of somebody who may be under it.
     */
    standAt: (x: number, y: number, z: number) => {
      // (Over the fort's passage out to its hatch the ground is cut down and the fort lays earth back over it at the
      // height the ground had, as the bunker's lid lies over its pit: whoever walks there has the ground AS IT IS
      // SEEN under them, which is `surface`. Everywhere else the two are one.)
      const ground = Math.max(heightAt(world.heights, x, z), heightAt(world.surface, x, z));
      // (and in the fort a body is on its terrace, a floor of its keep, a tower or a wall: whoever is within its walls
      // and no higher than its keep has something under them)
      if (inCastle(world.castle, x, y, z)) return Math.max(ground, y);
      return standAt(world.bridges, ground, x, y, z);
    },
    /** where the fort stands (null: the world has none) */
    castle: world.castle,
    /** whether a place is in the fort's lower levels or the passage out of them: under its terrace, and it may be under the ground, by right (as the bunker is) */
    castleUnder: (x: number, y: number, z: number) => castleUnder(world.castle, x, y, z, (gx, gz) => heightAt(world.surface, gx, gz)),
    /** whether a place is down a basement (src/sim/basements.ts: said by the plan of the houses above): under the ground by right, as the bunker is */
    basementUnder: (x: number, y: number, z: number) => basementUnder(world.basements, x, y, z),
    /** whether a place is on a basement's second level: what is kept there is the best kept under a house */
    basementDeep: (x: number, y: number, z: number) => basementDeep(world.basements, x, y, z),
    /** the bridges the road goes over */
    bridges: world.bridges,
    /** whether anything a body could stand on, climb or be up is within reach of a place: see server/bodywatch.ts */
    supportNear: supports(world, crates),
    /** somewhere open and level to set a supply drop down */
    dropSite: (rnd?: () => number, inside = false, avoid: { x: number; z: number }[] = []) => pickDropSite(world, rnd, inside, avoid),
    /** where a drop called on a radio comes down, for somebody standing at a place and facing a way */
    callSite: (x: number, y: number, z: number, yaw: number) => callSite(world, x, y, z, yaw),
  };
}
