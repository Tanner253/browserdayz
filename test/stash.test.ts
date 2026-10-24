// A case, a suitcase or a bag is a thing like any other (server/index.ts 'drop', 'take', 'bury'; src/sim/stash.ts;
// src/sim/economy.ts `keptAt`): dropped, it lies on the ground with what is in it and is taken again as anything is,
// by one player and no more; nothing is "put down" or "packed up". A shovel buries one that lies on the ground, and
// anybody's shovel digs it up, as often as wanted: it lies there again with what was in it. Nothing is taken or
// opened from under the ground; nothing is buried in a town, in a building or beside one; nothing but a case, a
// suitcase or a bag is buried at all. Left lying, an empty one is cleared away after its time, one with things in it
// later, a buried one never. The real server on a port of its own. About fifty seconds.
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
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'off', STASH_EMPTY_S: '45', STASH_FULL_S: '90' },
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

  type Lying = Extract<S2C, { t: 'loot+' }>['l'];
  const lying = (p: Player, uid: string) => p.got.filter((m): m is Extract<S2C, { t: 'loot+' }> => m.t === 'loot+').map((m) => m.l).filter((l: Lying) => l.uid === uid).pop();
  const gone = (p: Player, uid: string) => p.got.filter((m) => m.t === 'loot-' && m.uid === uid).length;
  const under = (p: Player, uid: string) => p.got.filter((m) => m.t === 'stash+' && m.s.uid === uid).length;
  const up = (p: Player, uid: string) => p.got.filter((m) => m.t === 'stash-' && m.uid === uid).length;
  const tin = { uid: 'stash-test-tin', id: 'beans', qty: 1 };
  const bag = { uid: 'stash-test-bag', id: 'black_bag', qty: 1, cargo: [{ item: tin, x: 1, y: 0, rot: false }] };
  const at = (item: unknown, dx = 0, x = wx, z = wz) => ({ item, x: x + dx, y: ground(x + dx, z), z, rot: 0.3 });

  // ---- a black bag dropped lies on the ground like anything else, with what is in it; nothing is "put down"
  ann.send({ t: 'drop', l: at(bag) });
  await sleep(300);
  const seen = lying(bob, bag.uid);
  assert.ok(seen && seen.item.id === 'black_bag', 'a bag dropped does not lie on the ground as a bag');
  assert.ok(seen.item.cargo?.length === 1 && seen.item.cargo[0].item.id === 'beans' && seen.item.cargo[0].x === 1, 'a bag dropped does not have in it what it was carried with');
  ann.send({ t: 'stash+', s: { uid: 'stash-test-placed', x: wx, y: ground(wx, wz), z: wz, rot: 0 } });
  ann.send({ t: 'stash-', uid: bag.uid });
  await sleep(300);
  assert.equal(bob.count('stash+') + bob.count('stash-'), 0, 'a stash can still be put down, or packed up, by saying so');
  assert.equal(gone(bob, bag.uid), 0, 'the bag went from the ground without being taken');
  checks++;
  console.log('  ok  a bag dropped lies on the ground as a bag, with what is in it; nothing is put down or packed up by saying so');

  // ---- buried with a shovel, and only with one; and nothing but a case, a suitcase or a bag
  ann.send({ t: 'bury', uid: bag.uid, on: true });
  await sleep(300);
  assert.equal(under(bob, bag.uid), 0, 'something was buried with bare hands');
  ann.say(wx + 1, wz, 'shovel');
  await sleep(200);
  ann.send({ t: 'drop', l: at({ uid: 'stash-test-loose-tin', id: 'beans', qty: 1 }, 0.6) });
  await sleep(200);
  ann.send({ t: 'bury', uid: 'stash-test-loose-tin', on: true });
  await sleep(300);
  assert.equal(under(bob, 'stash-test-loose-tin'), 0, 'a tin of beans was buried as a stash');
  ann.send({ t: 'bury', uid: bag.uid, on: true });
  await sleep(300);
  for (const p of [ann, bob]) {
    const s = p.got.filter((m): m is Extract<S2C, { t: 'stash+' }> => m.t === 'stash+' && m.s.uid === bag.uid).pop()?.s;
    assert.ok(s?.buried && s.item === 'black_bag' && Math.abs(s.x - wx) < 0.01, `${p.name} was not told the bag is under the ground there`);
    assert.equal(gone(p, bag.uid), 1, `${p.name} still sees the bag lying on the ground`);
  }
  // (under the ground it is not taken, and not opened)
  const opened = bob.count('cdata'), refused = bob.count('denied');
  bob.send({ t: 'take', uid: bag.uid });
  bob.send({ t: 'copen', cid: bag.uid });
  await sleep(300);
  assert.equal(bob.count('cdata'), opened, 'a stash was opened from under the ground');
  assert.equal(bob.count('denied'), refused + 1, 'a stash was taken from under the ground');
  // (somebody who comes in later is told where it is buried only once they come near it: server/stash-sight.ts)
  const late = new Player('Cat');
  assert.ok(await late.join());
  const w = late.last('welcome')!;
  assert.ok(!w.stashes.some((s) => s.uid === bag.uid), 'somebody who came in later is told from afar where it is buried');
  assert.ok(!w.loot.some((l) => l.uid === bag.uid), 'somebody who came in later is shown it lying on the ground as well');
  late.say(wx + 2, wz);
  for (let k = 0; k < 40 && !under(late, bag.uid); k++) await sleep(50);
  assert.ok(late.got.some((m) => m.t === 'stash+' && m.s.uid === bag.uid && m.s.buried && m.s.item === 'black_bag'), 'somebody who came in later is not shown where it is buried once near it');
  checks++;
  console.log('  ok  a shovel buries a bag that lies on the ground, bare hands do not, and a tin is not buried; under the ground it is neither taken nor opened');

  // ---- anybody with a shovel digs it up, and it lies there again with what was in it; as often as wanted
  bob.say(wx - 1, wz, 'shovel');
  await sleep(200);
  for (const [k, on] of [false, true, false].entries()) {
    bob.send({ t: 'bury', uid: bag.uid, on });
    await sleep(300);
    assert.equal(up(ann, bag.uid), on ? 1 : (k + 2) / 2, `somebody else's shovel did not ${on ? 'bury it again' : 'dig it up'}`);
    assert.equal(under(ann, bag.uid), on ? 2 : (k + 2) / 2, `somebody else's shovel did not ${on ? 'bury it again' : 'dig it up'}`);
    if (!on) {
      const back = lying(ann, bag.uid);
      assert.ok(back && back.item.id === 'black_bag' && back.item.cargo?.[0].item.id === 'beans' && back.item.cargo[0].x === 1, 'dug up, the bag does not lie there with what was in it');
    }
  }
  // (not from across a field)
  bob.say(wx - 30, wz, 'shovel');
  await sleep(200);
  bob.send({ t: 'bury', uid: bag.uid, on: true });
  await sleep(300);
  assert.equal(under(ann, bag.uid), 2, 'a bag was buried from thirty metres off');
  checks++;
  console.log('  ok  anybody with a shovel digs it up, and it lies there again with what was in it, as often as it is buried; not from across a field');

  // ---- taken like anything: by one player and no more
  bob.say(wx - 1, wz);
  await sleep(200);
  const was = ann.count('denied') + bob.count('denied'), left = gone(late, bag.uid);
  ann.send({ t: 'take', uid: bag.uid });
  bob.send({ t: 'take', uid: bag.uid });
  await sleep(400);
  assert.equal(ann.count('denied') + bob.count('denied'), was + 1, 'two who reached for it at once both carried it off (or neither did)');
  assert.equal(gone(late, bag.uid), left + 1, 'the others were not told it had gone');
  checks++;
  console.log('  ok  taken off the ground like anything, by one player and no more');

  // ---- nothing is buried in the town
  ann.say(town.x + 2, town.z + 3, 'shovel');
  await sleep(2600);
  const inTown = { uid: 'stash-test-in-town', id: 'old_suitcase', qty: 1 };
  ann.send({ t: 'drop', l: at(inTown, 1, town.x + 2, town.z + 3) });
  ann.say(town.x + 2, town.z + 3, 'shovel');
  await sleep(300);
  assert.ok(lying(bob, inTown.uid), 'a suitcase dropped in the town does not lie there');
  ann.send({ t: 'bury', uid: inTown.uid, on: true });
  await sleep(300);
  assert.equal(under(bob, inTown.uid), 0, 'a suitcase was buried in the middle of the town');
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

// ---- a container left lying is cleared away when its time is up: sooner empty than not, and never while it is under
// the ground. (The server again, with a week of four seconds and a fortnight of fourteen. It looks every five.)
{
  const dir2 = mkdtempSync(path.join(os.tmpdir(), 'zona-stash-'));
  const again = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir2, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'off', STASH_EMPTY_S: '4', STASH_FULL_S: '14' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  again.stdout!.on('data', (d) => (said += d));
  again.stderr!.on('data', (d) => (said += d));
  let wrong: unknown = null;
  try {
    for (let k = 0; k < 600 && !said.includes('listening'); k++) await sleep(100);
    assert.ok(said.includes('listening'), `the server did not start:\n${said.slice(-600)}`);
    const dee = new Player('Dee');
    assert.ok(await dee.join());
    const [wx, wz] = wild!;
    dee.say(wx + 1, wz, 'shovel');
    await sleep(200);
    const drop = (uid: string, dx: number, cargo?: unknown[]) => dee.send({ t: 'drop', l: { item: { uid, id: 'stash_kit', qty: 1, ...(cargo ? { cargo } : {}) }, x: wx + dx, y: ground(wx + dx, wz), z: wz, rot: 0 } });
    drop('empty', 0);
    drop('full', 1, [{ item: { uid: 'stash-test-tin-2', id: 'beans', qty: 1 }, x: 0, y: 0, rot: false }]);
    drop('buried', 2);
    await sleep(200);
    dee.send({ t: 'bury', uid: 'buried', on: true });
    await sleep(300);
    assert.ok(dee.got.some((m) => m.t === 'stash+' && m.s.uid === 'buried' && m.s.buried), 'a case could not be buried');
    // (nothing is cleared away under anybody's eyes: she walks off)
    dee.say(wx + 150, wz, 'shovel');
    const t0 = Date.now(), cleared = (uid: string) => dee.got.some((m) => m.t === 'loot-' && m.uid === uid), until = (s: number) => sleep(Math.max(0, t0 + s * 1000 - Date.now()));
    await until(2);
    assert.ok(!cleared('empty') && !cleared('full'), 'a case was cleared away before its time');
    await until(9.6);
    assert.ok(cleared('empty'), 'an empty case nobody came back to was still there after its time');
    assert.ok(!cleared('full'), 'a case with something in it went as soon as an empty one');
    await until(19.8);
    assert.ok(cleared('full'), 'a case with something in it was still there after its time');
    assert.ok(!dee.got.some((m) => m.t === 'stash-' && m.uid === 'buried'), 'a buried case was cleared away');
    // (and it is there still, under the ground, for whoever comes with a shovel)
    dee.say(wx + 1, wz, 'shovel');
    await sleep(2600);
    dee.send({ t: 'bury', uid: 'buried', on: false });
    await sleep(300);
    assert.ok(dee.got.some((m) => m.t === 'stash-' && m.uid === 'buried') && dee.got.some((m) => m.t === 'loot+' && m.l.uid === 'buried'), 'a buried case could not be dug up after everything round it had gone');
    checks++;
    console.log('  ok  left lying, an empty case is cleared away, one with things in it later, and a buried one never');
  } catch (e) {
    wrong = e;
  } finally {
    again.kill();
    await sleep(500);
    try {
      rmSync(dir2, { recursive: true, force: true });
    } catch {
      /* the server still letting go of it */
    }
  }
  if (wrong) {
    console.error(said.slice(-1200));
    throw wrong;
  }
}
console.log(`\n${checks} checks passed`);
process.exit(0);
