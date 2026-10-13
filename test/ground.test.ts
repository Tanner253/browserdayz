// What the ground is, place by place (src/world/ground.ts), against what the world says of the same places: the
// kinds add up at every point, every kind lies somewhere (a kind nothing uses is pictures loaded for nothing), a
// pine wood's floor is forest floor and answers as one, and a sheer face is rock.   npx tsx test/ground.test.ts

import assert from 'node:assert/strict';
import { KINDS, KIND_AT, KIND_NAMES, layGround } from '../src/world/ground';
import { CELL, WORLD_RES as N, generateWorld } from '../src/world/worldgen';

const world = generateWorld();
const t0 = performance.now();
const ground = layGround(world);
console.log(`the ground laid in ${(performance.now() - t0).toFixed(0)} ms`);
assert.equal(KIND_NAMES.length, 13, 'the paint reads thirteen kinds: four to a picture of weights, and one by itself');
assert.equal(ground.weights.length, 4);

const share = new Float64Array(KIND_NAMES.length);
let worst = 0;
for (let i = 0; i < N * N; i++) {
  let sum = 0, best = 0, most = -1;
  for (let k = 0; k < KIND_NAMES.length; k++) {
    const v = ground.weights[k >> 2][i * 4 + (k & 3)];
    sum += v;
    share[k] += v / 255;
    if (v > most) { most = v; best = k; }
  }
  worst = Math.max(worst, Math.abs(sum - 255));
  assert.equal(ground.weights[ground.top[i] >> 2][i * 4 + (ground.top[i] & 3)], ground.weights[best >> 2][i * 4 + (best & 3)], 'the kind said to be most is');
}
assert.ok(worst <= 6, `the kinds add up to the whole at every point (the worst is ${worst} of 255 out)`);
for (const [k, name] of KIND_NAMES.entries()) assert.ok(share[k] / (N * N) > 0.003, `${name} lies somewhere (${((share[k] / N / N) * 100).toFixed(2)}% of the map)`);

// a pine wood: the world says forest floor and nothing else, and pines stand within five metres
let wood = 0, floor = 0, face = 0, rock = 0;
const pines = new Uint8Array(N * N);
for (const t of world.trees) {
  if (!t.kind.startsWith('pine')) continue;
  const ix = Math.round((t.x + (N - 1)) / CELL), iz = Math.round((t.z + (N - 1)) / CELL);
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (ix + a >= 0 && ix + a < N && iz + b >= 0 && iz + b < N) pines[(iz + b) * N + ix + a] = 1;
}
for (let iz = 1; iz < N - 1; iz++) for (let ix = 1; ix < N - 1; ix++) {
  const i = iz * N + ix, H = world.heights;
  if (world.splat[i * 4 + 1] === 255 && pines[i]) {
    wood++;
    if (KINDS[KIND_NAMES[ground.top[i]]].sound === 'dirt') floor++;
  }
  const slope = Math.hypot(H[i + 1] - H[i - 1], H[i + N] - H[i - N]) / (2 * CELL);
  if (world.splat[i * 4 + 2] === 255 && slope > 1.5) {
    face++;
    if (ground.top[i] === KIND_AT.rock || ground.top[i] === KIND_AT.crag) rock++;
  }
}
assert.ok(wood > 1000 && floor / wood > 0.9, `a pine wood's floor is forest floor (${floor} of ${wood} points)`);
assert.ok(face > 1000 && rock / face > 0.9, `a sheer face is rock (${rock} of ${face} points)`);
console.log(`ok: ${KIND_NAMES.map((k, i) => `${k} ${((share[i] / N / N) * 100).toFixed(1)}%`).join(', ')}`);
