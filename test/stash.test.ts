// Stashes put down, buried and dug up (server/index.ts 'stash+', 'stash-', 'bury'; src/sim/stash.ts): the case,
// the suitcase and the black bag are stashes, each as big inside as it is, and a backpack is not; a shovel buries
// one and anybody's shovel digs it up, as often as wanted; nothing is opened or picked up from under the ground;
// nothing is buried in a town, in a building or beside one; and a stash is picked up with what is in it, by one
// player and no more. The real server on a port of its own. About twenty seconds.
//   npx tsx test/stash.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { BURY, noBurying } from '../src/sim/stash';
import { BUILDING_FOOTPRINT, generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8155;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
const can = (x: number, z: number) => noBurying(x, ground(x, z), z, ground(x, z), world.pois, world.buildings);

// ---- the rule by itself
let wild: [number, number] | null = null;
for (let x = -300; x <= 300 && !wild; x += 20) for (let z = -300; z <= 300 && !wild; z += 20) if (!can(x, z) && !can(x + 3, z)) wild = [x, z];
assert.ok(wild, 'there is nowhere in the country to bury anything');
const town = world.pois[0];
assert.match(can(town.x + 3, town.z + 3) ?? '', /town or a camp/);
const lone = world.buildings.find((b) => !world.pois.some((p) => Math.hypot(b.x - p.x, b.z - p.z) < p.radius + 40));
if (lone) {
  const f = BUILDING_FOOTPRINT[lone.type], out = f[1] / 2 + BURY.clear;
  // (straight out of its front door: just inside the distance, and well outside it)
  const at = (d: number): [number, number] => [lone.x + Math.sin(lone.rot) * d, lone.z + Math.cos(lone.rot) * d];
  assert.match(can(...at(out - 2)) ?? '', /beside a building/);
  assert.equal(can(...at(0)) === null, false, 'something can be buried under a floor');
}
assert.match(noBurying(wild[0], ground(...wild) + 3, wild[1], ground(...wild), world.pois, world.buildings) ?? '', /open ground/);
let checks = 1;
console.log('  ok  nothing is buried in a town or a camp, in a building, beside one, or off the ground; out in the country it is');

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public name: string, public key = `stash-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async join(): Promise<boolean> {
    this.got = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    if (!w) return false;
    this.id = w.you;
    return true;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  say(x: number, z: number, w: string | null = null) {
    this.send({ t: 's', p: [x, ground(x, z), z, 0, 0, 0], w, m: [] });
  }
  last<T extends S2C['t']>(t: T) {
    return this.got.filter((m) => m.t === t).pop() as Extract<S2C, { t: T }> | undefined;
  }
  count(t: S2C['t']) {
    return this.got.filter((m) => m.t === t).length;
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-stash-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const ann = new Player('Ann'), bob = new Player('Bob');
  for (const p of [ann, bob]) assert.ok(await p.join());
  const [wx, wz] = wild;
  ann.say(wx + 1, wz);
  bob.say(wx - 1, wz);
  await sleep(200);

  // ---- a black bag put down is a stash; a rifle is not, and neither is a backpack
  const pack = { uid: 'stash-test-bag', x: wx, y: ground(wx, wz), z: wz, rot: 0.3, item: 'black_bag' };
  const tin = { uid: 'stash-test-tin', id: 'beans', qty: 1, x: 1, y: 0, rot: false };
  ann.send({ t: 'stash+', s: pack });
  await sleep(300);
  assert.equal(bob.last('stash+')?.s.item, 'black_bag', 'a bag put down is not said to be one');
  bob.send({ t: 'copen', cid: pack.uid });
  await sleep(300);
  assert.deepEqual(bob.last('cdata')?.items, [], 'a stash put down was not empty');
  bob.send({ t: 'cset', cid: pack.uid, items: [tin] });
  bob.send({ t: 'cclose', cid: pack.uid });
  for (const item of ['ak', 'suitcase', 'no_such_thing']) ann.send({ t: 'stash+', s: { ...pack, uid: `stash-test-not-${item}`, item } });
  await sleep(300);
  assert.equal(bob.count('stash+'), 1, 'a rifle or a backpack was put down as a stash');
  checks++;
  console.log('  ok  a black bag put down is a stash, and keeps what is put in it; a rifle or a backpack is not one');

  // ---- buried with a shovel, and only with one; then nothing is opened or picked up
  ann.send({ t: 'bury', uid: pack.uid, on: true });
  await sleep(300);
  assert.equal(bob.count('stash~'), 0, 'something was buried with bare hands');
  ann.say(wx + 1, wz, 'shovel');
  await sleep(200);
  ann.send({ t: 'bury', uid: pack.uid, on: true });
  await sleep(300);
  assert.equal(bob.last('stash~')?.buried, true, 'a stash was not buried by somebody with a shovel beside it');
  assert.equal(ann.last('stash~')?.buried, true, 'whoever buried it was not told it was');
  const opened = bob.count('cdata');
  bob.send({ t: 'copen', cid: pack.uid });
  bob.send({ t: 'stash-', uid: pack.uid });
  await sleep(300);
  assert.equal(bob.count('cdata'), opened, 'a stash was opened from under the ground');
  assert.equal(bob.count('stashgot'), 0, 'a stash was picked up from under the ground');
  const late = new Player('Cat');
  assert.ok(await late.join());
  assert.ok(late.last('welcome')!.stashes.some((s) => s.uid === pack.uid && s.buried && s.item === 'black_bag'), 'somebody who came in later is not shown that it is buried');
  checks++;
  console.log('  ok  a shovel buries a stash and bare hands do not; buried, it is neither opened nor picked up');

  // ---- anybody with a shovel digs it up; and it is buried and dug up as often as wanted
  bob.say(wx - 1, wz, 'shovel');
  await sleep(200);
  for (const on of [false, true, false]) {
    bob.send({ t: 'bury', uid: pack.uid, on });
    await sleep(300);
    assert.equal(ann.last('stash~')?.buried, on, `somebody else's shovel did not ${on ? 'bury it again' : 'dig it up'}`);
  }
  // (not from across a field)
  bob.say(wx - 30, wz, 'shovel');
  await sleep(200);
  bob.send({ t: 'bury', uid: pack.uid, on: true });
  await sleep(300);
  assert.equal(ann.last('stash~')?.buried, false, 'a stash was buried from thirty metres off');
  checks++;
  console.log('  ok  anybody with a shovel digs it up, as often as it is buried; not from across a field');

  // ---- picked up with what is in it: by one player and no more; put down again, it has it still
  bob.say(wx - 1, wz);
  await sleep(200);
  ann.send({ t: 'stash-', uid: pack.uid });
  bob.send({ t: 'stash-', uid: pack.uid });
  await sleep(400);
  assert.equal(ann.count('stashgot') + bob.count('stashgot'), 1, 'two who reached for it at once both carried it off (or neither did)');
  const [has, other] = ann.last('stashgot') ? [ann, bob] : [bob, ann];
  const got = has.last('stashgot')!;
  assert.ok(got.item === 'black_bag' && got.items.length === 1 && got.items[0].id === 'beans' && got.items[0].x === 1, 'whoever picked it up did not get the bag with what was in it');
  assert.ok(other.got.some((m) => m.t === 'stash-' && m.uid === pack.uid), 'the other was not told it had gone');
  has.send({ t: 'stash+', s: { ...pack, uid: 'stash-test-bag-again' }, items: got.items });
  await sleep(300);
  other.send({ t: 'copen', cid: 'stash-test-bag-again' });
  await sleep(300);
  assert.deepEqual(other.last('cdata')?.items.map((i) => [i.id, i.x]), [['beans', 1]], 'a stash put down again did not have what it was carried with');
  other.send({ t: 'cclose', cid: 'stash-test-bag-again' });
  checks++;
  console.log('  ok  picked up with what is in it, by one player and no more; put down again, it has it still');

  // ---- nothing is buried in the town
  ann.say(town.x + 2, town.z + 3, 'shovel');
  await sleep(2600);
  const inTown = { uid: 'stash-test-in-town', x: town.x + 3, y: ground(town.x + 3, town.z + 3), z: town.z + 3, rot: 0 };
  ann.send({ t: 'stash+', s: inTown });
  ann.say(town.x + 2, town.z + 3, 'shovel');
  await sleep(300);
  const before = bob.count('stash~');
  ann.send({ t: 'bury', uid: inTown.uid, on: true });
  await sleep(300);
  assert.equal(bob.count('stash~'), before, 'a stash was buried in the middle of the town');
  assert.ok(ann.got.some((m) => m.t === 'tell' && /town or a camp/.test(m.text)), 'whoever tried was not told why');
  checks++;
  console.log('  ok  nothing is buried in the town, and whoever tries is told why');
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
  console.error(logged.slice(-1200));
  throw failed;
}
console.log(`\n${checks} checks passed`);
process.exit(0);
