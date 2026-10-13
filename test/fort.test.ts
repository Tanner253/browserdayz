// The fort on the mountain as the server knows it (MOUNTAIN.castle in src/world/worldgen.ts, src/sim/castle.ts):
// that nobody in it is written down by the checks on where a player says they are, which are enforced on the live
// game. Its terrace and the roof of its keep are far over the ground on the side the mountain falls away; its
// passage out to the storm-cellar hatch is under the ground, where the server's rule is that nobody may be.
//
// The real server is started, enforcing, on a port of its own, and five players are played against it over the
// wire for a quarter of a minute: one walks the terrace, one the roof of the keep, one the dark under the terrace,
// one the passage under the ground; and one stands three metres under open ground far from it, who is the only one
// of them written down. About half a minute.   npx tsx test/fort.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { CASTLE, UNDER, castleAt, castleLoose, castleUnder, hatchLine, inCastle, looseLocal } from '../src/sim/castle';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8147;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
/** the ground as it is seen: what the fort is told (over its hatch's stairwell that is the height the ground had) */
const seen = (x: number, z: number) => heightAt(world.surface, x, z);
const P = world.castle!;
assert.ok(P, 'the world has no fort');

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

// where each of them goes: places in the fort's own measure, [x, z, over the terrace]
const terrace: [number, number, number][] = [[7.6, -7.5, 0], [7.6, 7.5, 0], [-7.6, 7.5, 0], [-7.6, -7.5, 0]];
const roof: [number, number, number][] = [[-3, -2, CASTLE.keep.roof], [1, -2, CASTLE.keep.roof], [1, 1, CASTLE.keep.roof], [-3, 1, CASTLE.keep.roof]];
const dark: [number, number, number][] = [[0.8, -6.1, UNDER.floor], [-5, -6.1, UNDER.floor], [5, -6.1, UNDER.floor]];
// the passage: the sally port's own line (`hatchLine`), from the foot of the hatch's steps in the old village to where
// it leaves the fort. The ground over it is cut down for it and the fort lays earth back over the cut at the height
// the ground had: so whoever walks it is under the ground as it is SEEN, and that is what is asked here.
const hatch = castleLoose(P).find((l) => l.kind === 'hatch')!;
const way = hatchLine(looseLocal(P, [hatch])[0], seen(hatch.x, hatch.z) - P.y).path as [number, number, number][];
const passage: [number, number, number][] = [];
for (let k = 0; k + 1 < way.length; k++) {
  const a = way[k], b = way[k + 1], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / 1.5));
  for (let j = 0; j <= n; j++) {
    const x = a[0] + ((b[0] - a[0]) * j) / n, y = a[1] + ((b[1] - a[1]) * j) / n + 0.05, z = a[2] + ((b[2] - a[2]) * j) / n;
    const [wx, wy, wz] = castleAt(P, x, z, y);
    if (wy < seen(wx, wz) - 1.6 && !passage.some((q) => Math.hypot(q[0] - x, q[1] - z) < 1)) passage.push([x, z, y]);
  }
}
// (walked there and back, from its one end to its other)
const line = passage;

ok('the fort stands where the map says, and what is asked of the server is really asked: a terrace over a fall, a passage under the ground', () => {
  for (const [x, z, y] of [...terrace, ...roof]) assert.ok(inCastle(P, ...castleAt(P, x, z, y)), `a place on the terrace or the roof that is not in the fort: ${x}, ${z}`);
  // (the roof of the keep is far over the ground the mountain has under the fort)
  const [rx, ry, rz] = castleAt(P, ...roof[0]);
  assert.ok(ry - ground(rx, rz) > 12, `the keep's roof is only ${(ry - ground(rx, rz)).toFixed(1)} m over the ground`);
  for (const [x, z, y] of dark) assert.ok(castleUnder(P, ...castleAt(P, x, z, y), seen), `a place under the terrace that the fort does not own: ${x}, ${z}`);
  assert.ok(passage.length >= 8, `only ${passage.length} places of the passage are under the ground`);
  for (const [x, z, y] of passage) assert.ok(castleUnder(P, ...castleAt(P, x, z, y + 0.9), seen), `a place in the passage that the fort does not own: ${x.toFixed(1)}, ${z.toFixed(1)}`);
});

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  shut = false;
  constructor(public name: string, public key = `fort-test-key-${name}-${String(Math.random()).slice(2, 14).padStart(20, '0')}`) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 200 && !this.shut && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    assert.ok(this.got.some((m) => m.t === 'welcome'), `${this.name} was not let in`);
  }
  say(x: number, y: number, z: number) {
    // (looking about as they go, as anybody does: a head that never turns is a thing the server writes down for itself)
    if (!this.shut) this.ws.send(JSON.stringify({ t: 's', p: [x, y, z, Math.sin(Date.now() / 700), 0.1 * Math.cos(Date.now() / 900), 1], w: null, m: [] }));
  }
  /** along a round of places in the fort's own measure, at a walk: where they are after `t` seconds */
  walk(way: [number, number, number][], t: number, back = false) {
    const legs = way.map((p, i) => Math.hypot(way[(i + 1) % way.length][0] - p[0], way[(i + 1) % way.length][1] - p[1]));
    const all = legs.slice(0, back ? legs.length - 1 : legs.length).reduce((a, b) => a + b, 0);
    // (there and back along a way that is not a round; round and round one that is)
    let d = (t * 2) % (back ? all * 2 : all);
    if (back && d > all) d = all * 2 - d;
    let i = 0;
    while (d > legs[i] && i < legs.length - 1) (d -= legs[i]), i++;
    const a = way[i], b = way[(i + 1) % way.length], f = Math.min(1, d / (legs[i] || 1));
    this.say(...castleAt(P, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f));
  }
  get kicked(): string | undefined {
    return (this.got.find((m) => m.t === 'kick') as { reason: string } | undefined)?.reason;
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-fort-'));
const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', LINGER_S: '0', CHECKS: 'enforce', BOTCHECK: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
const flags = (name: string) => logged.split('\n').filter((l) => (l.includes('[check') || l.includes('void')) && l.includes(` ${name} `));
let failed: unknown = null;
try {
  for (let k = 0; k < 900 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const onTerrace = new Player('Terrace'), onRoof = new Player('Roof'), inDark = new Player('Dark'), inPassage = new Player('Passage'), buried = new Player('Buried');
  await Promise.all([onTerrace, onRoof, inDark, inPassage, buried].map((p) => p.join()));
  // each is set down where they begin, and a moment is given for it (as it is given to anybody set down anywhere)
  const begin = () => {
    onTerrace.walk(terrace, 0);
    onRoof.walk(roof, 0);
    inDark.walk(dark, 0, true);
    inPassage.walk(line, 0, true);
    buried.say(0, ground(0, 0), 0);
  };
  begin();
  await sleep(2800);
  const from = Date.now();
  for (let t = 0; t < 15; t = (Date.now() - from) / 1000) {
    onTerrace.walk(terrace, t);
    onRoof.walk(roof, t);
    inDark.walk(dark, t, true);
    inPassage.walk(line, t, true);
    buried.say(0, ground(0, 0) - 3, 0);
    await sleep(100);
  }
  await sleep(400);
  ok('nobody on the terrace or on the roof of the keep is written down', () => {
    assert.deepEqual(flags('Terrace'), []);
    assert.deepEqual(flags('Roof'), []);
    assert.equal(onTerrace.kicked ?? onRoof.kicked, undefined);
  });
  ok('nor anybody in the dark under the terrace, nor in the passage under the ground to the hatch', () => {
    assert.deepEqual(flags('Dark'), []);
    assert.deepEqual(flags('Passage'), []);
    assert.equal(inDark.kicked ?? inPassage.kicked, undefined);
  });
  ok('and the rule they are excused from is awake: somebody under open ground is written down and put off', () => {
    assert.ok(flags('Buried').some((l) => /under the ground/.test(l)), `nothing was written of Buried:\n${logged.split('\n').filter((l) => l.includes('[check')).join('\n')}`);
  });
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(500);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the server still letting go of it */
  }
}
if (failed) {
  console.error(logged.slice(-1500));
  throw failed;
}
console.log(`\n${n} checks passed`);
process.exit(0);
