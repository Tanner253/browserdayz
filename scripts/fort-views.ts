// Places to look at the fort from, for a picture in the game (assets-src/_wf/me/fort-look.js): each said in the
// fort's own measure (x, z, and height over the terrace; or 'g' and a height over the ground there), turned into
// the world's. npx tsx scripts/fort-views.ts <out.json>
import fs from 'node:fs';
import { CASTLE_SCALE, castleAt } from '../src/sim/castle';
import { generateWorld, heightAt } from '../src/world/worldgen';

const world = generateWorld(), P = world.castle!;
type At = [number, number, number | `g${number}`];
const rock: [string, At, At][] = [
  // where the walls meet the scanned rock under them, close
  ['rock-s1', [-1, 17, 'g1.6'], [-1, 11.8, -5.2]],
  ['rock-s2', [4, 17, 'g1.6'], [4, 11.9, -5.3]],
  ['rock-s3', [7.5, 17, 'g1.6'], [7.5, 11.8, -6]],
  ['rock-n1', [-2, -17, 'g1.6'], [-2, -11.8, -5.2]],
  ['rock-w1', [-17, -3, 'g1.6'], [-11.8, -3, -5.2]],
  ['rock-sw', [-15, 16, 'g1.6'], [-11, 12, -5]],
];
const views: [string, At, At][] = process.argv.includes('--rock') ? rock : [
  // the walls' feet outside, where they meet the hill and the rock
  ['foot-north', [0, -24, 'g1.7'], [0, -12, 'g0.5']],
  ['foot-south', [-2, 24, 'g1.7'], [-2, 12, 'g0.5']],
  ['foot-west', [-24, 2, 'g1.7'], [-12, 2, 'g0.5']],
  ['foot-east', [22, 6, 'g1.7'], [12, 6, 'g0.5']],
  ['foot-tower-nw', [-19, -19, 'g1.7'], [-11, -11.5, 'g1']],
  ['foot-tower-se', [19, 19, 'g1.7'], [11, 11.5, 'g1']],
  // the wall tops from the walk, and the parapet's broken merlons
  ['walk-north', [-6, -8, 1.6], [3, -9.6, 0.9]],
  ['walk-south', [5, 8, 1.6], [-4, 9.6, 0.9]],
  ['walk-west', [-8, 5, 1.6], [-9.6, -4, 0.9]],
  // the gate, the ramp's head and its foot
  ['gate-in', [5, -1.6, 1.6], [10, -1.6, 1.2]],
  ['ramp-foot', [22, -1.6, 'g1.7'], [14, -1.6, 'g0.5']],
  // doorways: a tower's from the terrace, the keep's, the keep's top
  ['door-tower', [6.5, -6.5, 1.6], [8.6, -8.6, 1.2]],
  ['door-keep', [7.5, 0, 1.6], [5.2, 0, 1.2]],
  ['keep-top', [0, 0, 10.3], [-4, -4.6, 11]],
  // the rent in the east wall, the breach on the north
  ['rent', [16, 5, 'g2'], [10, 4, -2]],
  ['breach', [-4.5, -19, 'g2'], [-4.5, -10.5, 0]],
];
const S = CASTLE_SCALE;
const world3 = (a: At) => {
  const [x, z, y] = a, [wx, , wz] = castleAt(P, x, z);
  return [wx, typeof y === 'number' ? P.y + S * y : heightAt(world.surface, wx, wz) + Number(y.slice(1)), wz].map((v) => +v.toFixed(2));
};
fs.writeFileSync(process.argv[2], JSON.stringify(views.map(([name, e, a]) => ({ name, eye: world3(e), at: world3(a) })), null, 1));
console.log(`${views.length} views: ${process.argv[2]}`);
