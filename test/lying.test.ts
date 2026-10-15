// What lies on the ground that holds things (a pack, a vest, a jacket, a bag) is gone through where it lies, as a crate
// is (server/handle.ts 'lopen', 'lset', 'lclose'): the one who opens it first has it, anybody else is told it is busy and
// cannot take it from under them, what they set is checked against its own grid and told to everybody, and shutting
// the pockets (or taking it) lets it go. The real server on a port of its own. About fifteen seconds.
//   npx tsx test/lying.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8227;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public name: string, public key = `lying-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
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
  say(x: number, z: number) {
    this.send({ t: 's', p: [x, ground(x, z), z, 0, 0, 0], w: null, m: [] });
  }
  of<T extends S2C['t']>(t: T, uid: string) {
    return this.got.filter((m) => m.t === t && (m as { uid?: string }).uid === uid) as Extract<S2C, { t: T }>[];
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-lying-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let checks = 0;
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const ann = new Player('Ann'), bob = new Player('Bob');
  for (const p of [ann, bob]) assert.ok(await p.join());
  // (out in the open, the two of them side by side)
  const wx = 40, wz = -40;
  ann.say(wx + 1, wz);
  bob.say(wx - 1, wz);
  await sleep(200);

  const tin = { uid: 'lying-test-tin', id: 'beans', qty: 1 };
  const bag = { uid: 'lying-test-bag', id: 'black_bag', qty: 1, cargo: [{ item: tin, x: 1, y: 0, rot: false }] };
  const jacket = { uid: 'lying-test-jacket', id: 'field_jacket', qty: 1 };
  const rock = { uid: 'lying-test-rock', id: 'beans', qty: 1 };
  const at = (item: unknown, dx = 0) => ({ item, x: wx + dx, y: ground(wx + dx, wz), z: wz, rot: 0.3 });
  ann.send({ t: 'drop', l: at(bag) });
  ann.send({ t: 'drop', l: at(jacket, 0.5) });
  ann.send({ t: 'drop', l: at(rock, -0.5) });
  await sleep(300);

  // ---- the first to open it has it; the other is told somebody is going through it; a tin is not opened at all
  ann.send({ t: 'lopen', uids: [bag.uid, jacket.uid, rock.uid] });
  await sleep(300);
  const data = ann.of('ldata', bag.uid).pop();
  assert.ok(data && data.items.length === 1 && data.items[0].id === 'beans' && data.items[0].x === 1, 'the bag opened does not show what is in it');
  assert.ok(ann.of('ldata', jacket.uid).pop()?.items.length === 0, 'a jacket lying there is not opened, empty');
  assert.equal(ann.of('ldata', rock.uid).length, 0, 'a tin of beans was opened as if it held things');
  bob.send({ t: 'lopen', uids: [bag.uid] });
  await sleep(300);
  assert.equal(bob.of('lbusy', bag.uid).length, 1, 'the other was not told somebody is going through the bag');
  assert.equal(bob.of('ldata', bag.uid).length, 0, 'the other was let into a bag somebody else has open');
  checks++;
  console.log('  ok  the first to open a bag lying there has it, the other is told it is busy; a jacket opens, a tin does not');

  // ---- not taken from under the one going through it
  bob.send({ t: 'take', uid: bag.uid });
  await sleep(300);
  assert.equal(bob.of('denied', bag.uid).length, 1, 'a bag was taken from under somebody going through it');
  assert.equal(ann.of('loot-', bag.uid).length, 0, 'the bag went from the ground while somebody was going through it');
  checks++;
  console.log('  ok  nobody takes a bag from under the one going through it');

  // ---- what they set is told to everybody; what does not fit its grid is refused and they are told what is in it
  const moved = [{ ...tin, x: 3, y: 2, rot: false }, { uid: 'lying-test-tin-2', id: 'beans', qty: 1, x: 0, y: 0, rot: false }];
  ann.send({ t: 'lset', uid: bag.uid, items: moved });
  await sleep(300);
  const told = bob.of('lcargo', bag.uid).pop();
  assert.ok(told && told.items.length === 2 && told.items.some((s) => s.uid === tin.uid && s.x === 3 && s.y === 2), 'what was moved in the bag was not told to the other');
  const before = ann.of('ldata', bag.uid).length;
  ann.send({ t: 'lset', uid: bag.uid, items: [{ ...tin, x: 0, y: 0, rot: false }, { uid: 'lying-test-tin-3', id: 'beans', qty: 1, x: 0, y: 0, rot: false }] });
  ann.send({ t: 'lset', uid: bag.uid, items: [{ ...tin, x: 40, y: 0, rot: false }] });
  // (a bag with a bag in it with a tin in that: as the pockets' own grid refuses it)
  const inner = { uid: 'lying-test-bag-3', id: 'black_bag', qty: 1, cargo: [{ item: { uid: 'lying-test-tin-4', id: 'beans', qty: 1 }, x: 0, y: 0, rot: false }] };
  ann.send({ t: 'lset', uid: bag.uid, items: [{ uid: 'lying-test-bag-2', id: 'black_bag', qty: 1, cargo: [{ item: inner, x: 0, y: 0, rot: false }], x: 0, y: 0, rot: false }] });
  await sleep(300);
  assert.equal(ann.of('ldata', bag.uid).length, before + 3, 'two tins on one spot, one off the grid, or bags in bags was not refused');
  assert.equal(bob.of('lcargo', bag.uid).length, 1, 'a refused change was told to the other');
  bob.send({ t: 'lset', uid: bag.uid, items: [] });
  await sleep(300);
  assert.equal(ann.of('lcargo', bag.uid).length, 1, 'somebody emptied a bag they did not have open');
  checks++;
  console.log('  ok  what is set in it is told to everybody; on one spot, off its grid, bags in bags, or by the other: refused');

  // ---- shut, it is the other's to open; and taken by the one who has it, it is let go
  ann.send({ t: 'lclose' });
  await sleep(200);
  bob.send({ t: 'lopen', uids: [bag.uid] });
  await sleep(300);
  const now = bob.of('ldata', bag.uid).pop();
  assert.ok(now && now.items.length === 2 && now.items.some((s) => s.uid === tin.uid && s.x === 3), 'shut, the bag was not the other\'s to open with what was set in it');
  bob.send({ t: 'take', uid: bag.uid });
  await sleep(300);
  assert.equal(ann.of('loot-', bag.uid).length, 1, 'the one going through it could not take it');
  checks++;
  console.log('  ok  shut, the other opens it as it was left, and takes it');

  // ---- not from across a field
  bob.say(wx - 30, wz);
  await sleep(200);
  bob.send({ t: 'lopen', uids: [jacket.uid] });
  await sleep(300);
  assert.equal(bob.of('ldata', jacket.uid).length + bob.of('lbusy', jacket.uid).length, 0, 'a jacket was opened from thirty metres off');
  checks++;
  console.log('  ok  nothing is opened from across a field');
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
