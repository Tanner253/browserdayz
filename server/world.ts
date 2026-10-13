// The server builds the same world the clients do, from the same code and seed, so
// loot points, crates, doors and spawn points line up exactly without sending the map.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { bunkerPlace, generateWorld, heightAt } from '../src/world/worldgen';
import { BUNKER, bunkerAt, bunkerCrates, levelY } from '../src/sim/bunker';
import { Buildings, CRATE_KINDS, SEARCHED_KINDS } from '../src/world/buildings';
import { assets } from '../src/core/assets';
import { crateId } from '../src/net/protocol';
import { pickDropSite } from '../src/sim/drops';
import { barrelSpots } from '../src/sim/barrels';
import { JEEP, POLICE_CAR, jeepSpots, policeSpots } from '../src/sim/vehicles';
import { homeSpot, infectedHomes, type Home } from '../src/sim/infected';
import { fireSpots } from '../src/sim/fires';
import { gasZone } from '../src/sim/gas';
import { standAt } from '../src/sim/bridge';
import { castleUnder, inCastle } from '../src/sim/castle';

export interface CrateSpot {
  cid: string;
  kind: string;
  x: number;
  y: number;
  z: number;
}

export function buildWorldData(root: string) {
  const manifestPath = [path.join(root, 'dist/assets/manifest.json'), path.join(root, 'public/assets/manifest.json')].find((p) => existsSync(p));
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
    spawns: world.spawns,
    /** where the infected live, and somewhere to stand one about such a place (see src/sim/infected.ts) */
    homes: infectedHomes(world),
    homeSpot: (h: Home) => homeSpot(world, h, Math.random),
    doorCount: buildings.doorSpecs.length,
    groundAt: (x: number, z: number) => heightAt(world.heights, x, z),
    /**
     * What somebody at a place has under them to stand on: the ground, or the deck of a bridge for whoever is on
     * one (see src/sim/bridge.ts). Asked wherever it is a question of somebody being in the air: `groundAt` is the
     * ground alone, and is what is asked of somebody who may be under it.
     */
    standAt: (x: number, y: number, z: number) => {
      // (and in the fort a body is on its terrace, a floor of its keep, a tower or a wall: whoever is within its walls
      // and no higher than its keep has something under them)
      if (inCastle(world.castle, x, y, z)) return Math.max(heightAt(world.heights, x, z), y);
      return standAt(world.bridges, heightAt(world.heights, x, z), x, y, z);
    },
    /** where the fort stands (null: the world has none) */
    castle: world.castle,
    /** whether a place is in the fort's lower levels or the passage out of them: under its terrace, and it may be under the ground, by right (as the bunker is) */
    castleUnder: (x: number, y: number, z: number) => castleUnder(world.castle, x, y, z, (gx, gz) => heightAt(world.surface, gx, gz)),
    /** the bridges the road goes over */
    bridges: world.bridges,
    /** somewhere open and level to set a supply drop down */
    dropSite: (rnd?: () => number, inside = false, avoid: { x: number; z: number }[] = []) => pickDropSite(world, rnd, inside, avoid),
  };
}
