// The server builds the same world the clients do, from the same code and seed, so
// loot points, crates, doors and spawn points line up exactly without sending the map.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { generateWorld, heightAt } from '../src/world/worldgen';
import { Buildings, CRATE_KINDS } from '../src/world/buildings';
import { assets } from '../src/core/assets';
import { crateId } from '../src/net/protocol';
import { pickDropSite } from '../src/sim/drops';
import { barrelSpots } from '../src/sim/barrels';

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
  (assets as { manifest: unknown }).manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const world = generateWorld();
  const buildings = new Buildings(world, null as never);
  buildings.plan();
  const crates: CrateSpot[] = world.props
    .map((p) => ({ p, kind: p.kind.split(/[#@]/)[0] }))
    .filter(({ kind }) => CRATE_KINDS.has(kind))
    .map(({ p, kind }) => ({ cid: crateId(p.x, p.z), kind, x: p.x, y: p.y, z: p.z }));
  return {
    lootPoints: buildings.lootPoints,
    crates,
    /** the fuel drums, numbered as the game numbers them */
    barrels: barrelSpots(world.props).map((p) => ({ x: p.x, y: p.y, z: p.z })),
    spawns: world.spawns,
    doorCount: buildings.doorSpecs.length,
    groundAt: (x: number, z: number) => heightAt(world.heights, x, z),
    /** somewhere open and level to set a supply drop down */
    dropSite: (rnd?: () => number) => pickDropSite(world, rnd),
  };
}
