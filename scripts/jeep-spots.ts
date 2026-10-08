// Where the jeeps stand, and what is round each of them: how far from the middle of the map,
// from the road, from the nearest tree and the nearest building.
// npx tsx scripts/jeep-spots.ts
import { generateWorld, PLAY_RADIUS } from '../src/world/worldgen';
import { jeepSpots } from '../src/sim/vehicles';
import { buildWorldData } from '../server/world';

const world = generateWorld();
const p = world.road.points;
const toRoad = (x: number, z: number) => {
  let d = Infinity;
  for (let i = 0; i < p.length; i += 3) d = Math.min(d, Math.hypot(p[i] - x, p[i + 2] - z));
  return d;
};
const nearest = (list: { x: number; z: number }[], x: number, z: number) => list.reduce((d, t) => Math.min(d, Math.hypot(t.x - x, t.z - z)), Infinity);
const compass = (x: number, z: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][((Math.round(Math.atan2(x, -z) / (Math.PI / 4)) % 8) + 8) % 8];

console.log(`play radius ${PLAY_RADIUS} m; ${world.sites.length} outlying places; ${world.spawns.length} places to start`);
for (const s of world.sites) console.log(`  place ${s.kind.padEnd(6)} ${s.name.padEnd(22)} ${compass(s.x, s.z).padEnd(2)} ${Math.hypot(s.x, s.z).toFixed(0).padStart(4)} m out, ${toRoad(s.x, s.z).toFixed(0).padStart(4)} m from the road`);
const spots = jeepSpots(world);
spots.forEach((j, i) => {
  console.log(
    `jeep ${i}: ${j.x.toFixed(0).padStart(5)}, ${j.z.toFixed(0).padStart(5)}  ${compass(j.x, j.z).padEnd(2)} ${Math.hypot(j.x, j.z).toFixed(0).padStart(4)} m out, ${toRoad(j.x, j.z).toFixed(0).padStart(4)} m from the road, tree ${nearest(world.trees, j.x, j.z).toFixed(1)} m, building ${nearest(world.buildings, j.x, j.z).toFixed(1)} m, ` +
      `nearest other jeep ${Math.min(...spots.filter((o) => o !== j).map((o) => Math.hypot(o.x - j.x, o.z - j.z))).toFixed(0)} m`,
  );
});

// the server lays out the yards of the places before it stands its jeeps, a game on its own
// may not have: the two must come to the same spots
const served = buildWorldData(process.cwd()).jeeps;
const same = served.length === spots.length && served.every((j, i) => Math.hypot(j.x - spots[i].x, j.z - spots[i].z) < 1e-6 && j.yaw === spots[i].yaw);
console.log(same ? `the server stands the same ${served.length}` : `THE SERVER DIFFERS: ${JSON.stringify(served)}`);
if (!same) process.exit(1);
