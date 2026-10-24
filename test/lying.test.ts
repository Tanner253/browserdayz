// What lies on the ground that holds things (a pack, a vest, a jacket, a bag) is gone through where it lies, as a crate
// is (server/handle.ts 'lopen', 'lops', 'lset', 'lclose'; server/searched.ts): by as many as like at once, move by move,
// each move checked against its own grid and told to everybody, one that cannot be done refused to whoever made it
// ('cno'), and taking it lets everybody go of it. The real server on a port of its own. About fifteen seconds.
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
  const ann = new Player('Ann'), bob = new Player('Bob'), cat = new Player('Cat');
  for (const p of [ann, bob, cat]) assert.ok(await p.join());
  // (out in the open, the three of them side by side)
  const wx = 40, wz = -40;
  ann.say(wx + 1, wz);
  bob.say(wx - 1, wz);
  cat.say(wx, wz + 1);
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
  const noes = (p: Player) => p.got.filter((m) => m.t === 'cno' && m.l === bag.uid) as Extract<S2C, { t: 'cno' }>[];

  // ---- gone through by two at once (2026-10-23: players "locked out" of what somebody else had open); a tin is not opened at all
  ann.send({ t: 'lopen', uids: [bag.uid, jacket.uid, rock.uid] });
  await sleep(300);
  const data = ann.of('ldata', bag.uid).pop();
  assert.ok(data && data.items.length === 1 && data.items[0].id === 'beans' && data.items[0].x === 1, 'the bag opened does not show what is in it');
  assert.ok(ann.of('ldata', jacket.uid).pop()?.items.length === 0, 'a jacket lying there is not opened, empty');
  assert.equal(ann.of('ldata', rock.uid).length, 0, 'a tin of beans was opened as if it held things');
  bob.send({ t: 'lopen', uids: [bag.uid] });
  await sleep(300);
  assert.equal(bob.of('lbusy', bag.uid).length, 0, 'the other was told the bag is busy');
  assert.ok(bob.of('ldata', bag.uid).pop()?.items.some((s) => s.uid === tin.uid), 'the other was not let into a bag somebody else has open');
  checks++;
  console.log('  ok  a bag lying there is gone through by two at once; a jacket opens, a tin does not');

  // ---- a move by one is told to everybody; one that cannot be done is refused to whoever made it, and nobody else hears of it
  const tin2 = { uid: 'lying-test-tin-2', id: 'beans', qty: 1 };
  ann.send({ t: 'lops', uid: bag.uid, ops: [{ o: 'move', uid: tin.uid, x: 3, y: 2, rot: false }, { o: 'put', item: { ...tin2, x: 0, y: 0, rot: false } }] });
  await sleep(300);
  const told = bob.of('lcargo', bag.uid).pop();
  assert.ok(told && told.items.length === 2 && told.items.some((s) => s.uid === tin.uid && s.x === 3 && s.y === 2), 'what was moved in the bag was not told to the other');
  // (a tin put down where another has just been put goes wherever there is room, and everybody is told)
  ann.send({ t: 'lops', uid: bag.uid, ops: [{ o: 'put', item: { uid: 'lying-test-tin-3', id: 'beans', qty: 1, x: 0, y: 0, rot: false } }] });
  await sleep(300);
  const laid = bob.of('lcargo', bag.uid).pop()?.items.find((s) => s.uid === 'lying-test-tin-3');
  assert.ok(laid && (laid.x !== 0 || laid.y !== 0), 'a tin put on another was not laid where there is room');
  // (a move that cannot be made, off its grid, changes nothing: whoever made it is shown it as it is, nobody else is told)
  const annSaw = ann.of('lcargo', bag.uid).length, bobSaw = bob.of('lcargo', bag.uid).length;
  ann.send({ t: 'lops', uid: bag.uid, ops: [{ o: 'move', uid: tin.uid, x: 40, y: 0, rot: false }] });
  await sleep(300);
  assert.ok(ann.of('lcargo', bag.uid).length === annSaw + 1 && ann.of('lcargo', bag.uid).pop()!.items.some((s) => s.uid === tin.uid && s.x === 3), 'whoever made a move that could not be made was not shown the bag as it is');
  assert.equal(bob.of('lcargo', bag.uid).length, bobSaw, 'a move that changed nothing was told to the other');
  // (a bag with a bag in it with a tin in that: refused by the bag's own grid, as the pockets' own refuses it, and given back)
  const inner = { uid: 'lying-test-bag-3', id: 'black_bag', qty: 1, cargo: [{ item: { uid: 'lying-test-tin-4', id: 'beans', qty: 1 }, x: 0, y: 0, rot: false }] };
  ann.send({ t: 'lops', uid: bag.uid, ops: [{ o: 'put', item: { uid: 'lying-test-bag-2', id: 'black_bag', qty: 1, cargo: [{ item: inner, x: 0, y: 0, rot: false }], x: 5, y: 0, rot: false } }] });
  await sleep(300);
  assert.deepEqual(noes(ann).map((m) => m.back.map((b) => b.uid)), [['lying-test-bag-2']], 'a bag with things in things in it was not refused and given back');
  assert.equal(bob.of('lcargo', bag.uid).length, bobSaw, 'a refused move was told to the other');
  // (somebody beside it who has not opened it moves nothing in it)
  const before = ann.of('lcargo', bag.uid).length;
  cat.send({ t: 'lops', uid: bag.uid, ops: [{ o: 'take', uid: tin2.uid }] });
  cat.send({ t: 'lset', uid: bag.uid, items: [] });
  await sleep(300);
  assert.equal(ann.of('lcargo', bag.uid).length, before, 'somebody emptied a bag they did not have open');
  checks++;
  console.log('  ok  a move is told to everybody; one onto another laid where there is room; off its grid, bags in bags, or by somebody without it open: nothing comes of it');

  // ---- the same tin taken by both: the first has it, the second is told it is gone and loses nothing
  ann.send({ t: 'lops', uid: bag.uid, ops: [{ o: 'take', uid: tin.uid }] });
  bob.send({ t: 'lops', uid: bag.uid, ops: [{ o: 'take', uid: tin.uid }] });
  await sleep(300);
  const last = ann.of('lcargo', bag.uid).pop();
  assert.ok(last && !last.items.some((s) => s.uid === tin.uid) && last.items.some((s) => s.uid === tin2.uid), 'the tin taken is still in the bag, or the other tin went with it');
  assert.deepEqual(noes(bob).flatMap((m) => m.took.map((t) => t.uid)), [tin.uid], 'the second to take the tin was not told it was gone');
  assert.equal(noes(ann).length, 1, 'the first to take the tin was refused it');
  checks++;
  console.log('  ok  one thing taken by two at once: the first has it, the second is told');

  // ---- an old game, which says the whole of what is in it: its word is made into moves
  bob.send({ t: 'lset', uid: bag.uid, items: [{ ...tin2, x: 2, y: 1, rot: false }] });
  await sleep(300);
  assert.ok(ann.of('lcargo', bag.uid).pop()?.items.some((s) => s.uid === tin2.uid && s.x === 2 && s.y === 1), 'what an old game set was not made into a move and told');
  checks++;
  console.log('  ok  an old game\'s whole contents are made into the moves from what is in it');

  // ---- shut by one, it stays open to the other; taken by either, it goes, and both are let go of it
  ann.send({ t: 'lclose' });
  await sleep(200);
  bob.send({ t: 'lops', uid: bag.uid, ops: [{ o: 'move', uid: tin2.uid, x: 0, y: 0, rot: false }] });
  await sleep(300);
  assert.ok(ann.of('lcargo', bag.uid).pop()?.items.some((s) => s.uid === tin2.uid && s.x === 0), 'the other could not go on with it when one shut their pockets');
  ann.send({ t: 'take', uid: bag.uid });
  // (told on the economy's next tick: given a while, on a machine that is busy)
  for (let k = 0; k < 30 && !bob.of('loot-', bag.uid).length; k++) await sleep(100);
  assert.equal(bob.of('loot-', bag.uid).length, 1, 'a bag could not be taken while somebody else was going through it');
  const after = bob.of('lcargo', bag.uid).length;
  bob.send({ t: 'lops', uid: bag.uid, ops: [{ o: 'take', uid: tin2.uid }] });
  await sleep(300);
  assert.equal(bob.of('lcargo', bag.uid).length, after, 'a bag that was taken was still gone through');
  checks++;
  console.log('  ok  shut by one, the other goes on; taken, it is gone for both');

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
