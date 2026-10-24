// Crates, bodies and bags lying about gone through by several at once, move by move (src/sim/box-ops.ts and
// server/searched.ts; the owner, 2026-10-23, of "Someone else is searching that" and the "Opening…" wait): the moves
// worked out from what a game had and has, done to a grid as it is now; two players in one body, each taking a
// different thing, both keep it; both taking the same thing, the second is told so and nothing is made twice; a body's
// contents asked for on the way to it open nothing; a pack lying on the ground, the same. The real server on a port of
// its own, players over the wire. About a minute.
//   npx tsx test/shared-boxes.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C, type StoredItem } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';
import { applyOps, diffOps, type Laid } from '../src/sim/box-ops';
import { makeItem, type ItemInstance } from '../src/sim/items';

let checks = 0;
const ok = (what: string) => {
  checks++;
  console.log(`  ok  ${what}`);
};

// ---- the moves themselves, without a server
{
  const lay = (it: ItemInstance, x: number, y: number): Laid => ({ ...it, x, y, rot: false });
  const can = lay(makeItem('beans'), 0, 0), pile = lay(makeItem('ammo_9mm', 20), 2, 0), pack = lay(makeItem('sack_pack'), 4, 0);
  const inside = makeItem('bandage');
  pack.cargo = [{ item: inside, x: 0, y: 0, rot: false }];
  const before = [can, pile, pack];
  const after: Laid[] = [lay({ ...pile, qty: 15 }, 2, 1), { ...pack, cargo: [] }, lay(makeItem('compass'), 0, 3)];
  const ops = diffOps(before, after);
  const kinds = ops.map((o) => `${o.o}${'in' in o && o.in ? ' in' : ''}`).sort().join(',');
  assert.equal(kinds, 'move,put,take,take,take in', `the moves were not what was done: ${kinds}`);
  const clean = (raw: unknown) => (raw && typeof raw === 'object' ? ({ ...(raw as ItemInstance) }) : null);
  // (done to the grid as it is, where somebody else has since taken the beans: that take is refused, the rest done)
  const now = before.filter((it) => it.uid !== can.uid).map((it) => ({ ...it, cargo: it.cargo?.map((p) => ({ ...p, item: { ...p.item } })) }));
  const r = applyOps(now as Laid[], 8, 6, ops, () => true, clean);
  assert.deepEqual(r.refused.took.map((t) => t.uid), [can.uid], 'a thing gone before was not refused');
  assert.equal(r.items.find((it) => it.uid === pile.uid)?.qty, 15, 'the five rounds were not taken off the pile');
  assert.equal(r.items.find((it) => it.uid === pack.uid)?.cargo?.length, 0, 'the bandage was not taken out of the pack');
  assert.ok(r.items.some((it) => it.id === 'compass'), 'the compass was not put in');
  // (no room: given back)
  const full = applyOps([lay(makeItem('suitcase'), 0, 0)], 4, 3, [{ o: 'put', item: lay(makeItem('suitcase'), 0, 0) }], () => true, clean);
  assert.equal(full.refused.back.length, 1, 'a thing with no room was not given back');
  ok('a game\'s moves are worked out from what it had and has, and done to the grid as it is now: what is gone is refused, what has no room is given back');
}

const PORT = 8323;
/** is a thing of this number anywhere in these, however deep */
const has = (items: (StoredItem | ItemInstance)[], uid: string): boolean => items.some((it) => it.uid === uid || has((it.cargo ?? []).map((p) => p.item), uid));
/** what is in Dan's pack on his body */
const inDans = (items: StoredItem[]) => (items.find((it) => it.uid === 'pack-Dan')?.cargo ?? []).map((p) => p.item.uid).sort();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public name: string, public key = `shared-boxes-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.send({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name });
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    assert.ok(w, `${this.name} was not let in`);
    this.id = w.you;
  }
  send(m: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  say(x: number) {
    this.send({ t: 's', p: [x, ground(x, 0), 0, 0, 0, 0], w: null, m: [] });
  }
  /** what it carries, as its game says: these things in a pack on its back */
  carry(things: object[]) {
    this.send({ t: 'me', inv: { slots: { back: { uid: `pack-${this.name}`, id: 'suitcase', qty: 1, cargo: things.map((it, i) => ({ item: it, x: i % 4, y: Math.floor(i / 4), rot: false })) } }, active: null, containers: [] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
  async heard<T extends S2C['t']>(t: T, pred: (m: Extract<S2C, { t: T }>) => boolean = () => true, ms = 2000) {
    for (let k = 0; k < ms / 50; k++) {
      const m = this.got.find((x) => x.t === t && pred(x as Extract<S2C, { t: T }>));
      if (m) return m as Extract<S2C, { t: T }>;
      await sleep(50);
    }
    return undefined;
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-shared-boxes-'));
// (the site it would report to is nowhere)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'off', TAG_FRESH_S: '1', TAG_MIN_LIFE_S: '1', FRESH_S: '0.2' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const ann = new Player('Ann'), bob = new Player('Bob'), cat = new Player('Cat'), dan = new Player('Dan');
  for (const p of [ann, bob, cat, dan]) await p.join();
  for (let t = 0; t < 1200; t += 400) {
    ann.say(30);
    bob.say(31);
    cat.say(32);
    dan.say(33);
    await sleep(400);
  }
  // ---- Dan dies with three things in his pack: his body lies there to be gone through
  const gun = { uid: 'sb-colt', id: 'colt', qty: 1, mag: 'mag_colt', loaded: 8 }, rounds = { uid: 'sb-rounds', id: 'ammo_45', qty: 20 }, food = { uid: 'sb-beans', id: 'beans', qty: 1 };
  dan.carry([gun, rounds, food]);
  await sleep(300);
  dan.send({ t: 'died', cause: 'test' });
  const death = await ann.heard('death', (m) => m.k.id === dan.id);
  assert.ok(death?.corpse, `Dan left no body:\n${logged.slice(-600)}`);
  const cid = death.corpse.uid;

  // ---- Cat asks what is in it on her way: she is told, and has nothing open (no doors, nobody held, her moves not done)
  cat.send({ t: 'cpeek', cid });
  const peek = await cat.heard('cdata', (m) => m.cid === cid);
  assert.ok(peek && has(peek.items, gun.uid), 'what is in the body was not told to whoever asked on the way to it');
  cat.send({ t: 'cops', cid, ops: [{ o: 'take', uid: gun.uid, in: 'pack-Dan' }] });
  await sleep(300);
  ok('a body\'s contents are told to whoever asks on the way to it, and asking opens nothing: moves from them are not done');

  // ---- Ann and Bob both open it: neither is turned away
  ann.send({ t: 'copen', cid });
  bob.send({ t: 'copen', cid });
  const a0 = await ann.heard('cdata', (m) => m.cid === cid), b0 = await bob.heard('cdata', (m) => m.cid === cid);
  assert.ok(a0 && b0, `both did not get what is in it:\n${logged.slice(-600)}`);
  assert.ok(!bob.got.some((m) => m.t === 'cbusy') && !ann.got.some((m) => m.t === 'cbusy'), 'somebody was told it was busy');
  assert.ok(has(a0.items, gun.uid), 'Cat\'s take, with nothing open, was done');
  ok('two players open one body at once, and neither is told somebody else is searching it');

  // ---- each takes a different thing at once: both keep theirs, and each is told what is in it now
  ann.got.length = 0;
  bob.got.length = 0;
  ann.send({ t: 'cops', cid, ops: [{ o: 'take', uid: gun.uid, in: 'pack-Dan' }] });
  bob.send({ t: 'cops', cid, ops: [{ o: 'take', uid: food.uid, in: 'pack-Dan' }] });
  await sleep(500);
  const last = (p: Player) => p.got.filter((m): m is Extract<S2C, { t: 'cdata' }> => m.t === 'cdata' && m.cid === cid).pop();
  assert.ok(last(ann) && last(bob), 'they were not told what is in it after');
  for (const p of [ann, bob]) assert.deepEqual(inDans(last(p)!.items), [rounds.uid], `${p.name} was told something else is in it: ${JSON.stringify(inDans(last(p)!.items))}`);
  assert.ok(!ann.got.some((m) => m.t === 'cno') && !bob.got.some((m) => m.t === 'cno'), 'a take that nobody else made was refused');
  ok('two take different things at once: both keep them, and both are told what is left');

  // ---- both take the rounds: the first has them, the second is told they are gone (and nothing is made twice)
  ann.got.length = 0;
  bob.got.length = 0;
  ann.send({ t: 'cops', cid, ops: [{ o: 'take', uid: rounds.uid, in: 'pack-Dan' }] });
  await sleep(150);
  bob.send({ t: 'cops', cid, ops: [{ o: 'take', uid: rounds.uid, in: 'pack-Dan' }] });
  const no = await bob.heard('cno', (m) => m.cid === cid);
  assert.ok(no?.took.some((t) => t.uid === rounds.uid), `the second to take the rounds was not told they were gone:\n${logged.slice(-600)}`);
  assert.ok(!ann.got.some((m) => m.t === 'cno'), 'the first to take them was refused');
  // (Bob's game, not yet told, says he has them: the server does not believe it)
  bob.carry([rounds]);
  await sleep(200);
  bob.send({ t: 'drop', l: { uid: rounds.uid, item: rounds, x: 31.3, y: ground(31.3, 0.4), z: 0.4, rot: 0, point: -1, spawnedAt: 0 } });
  await sleep(300);
  assert.ok(!logged.includes('Bob dropped') && !(await cat.heard('loot+', (m) => m.l.uid === rounds.uid, 400)), 'Bob put down rounds he was told somebody else had taken');
  ok('both take the same thing: the first has it, the second is told and cannot put it down, so nothing is had twice');

  // ---- a pack put down: Ann and Bob go through it where it lies at once, and the same holds
  const inPack = [{ item: { uid: 'sb-band', id: 'bandage', qty: 1 }, x: 0, y: 0, rot: false }, { item: { uid: 'sb-stim', id: 'stim', qty: 1 }, x: 1, y: 0, rot: false }];
  const lyingPack = { uid: 'sb-pack', id: 'sack_pack', qty: 1, cargo: inPack };
  ann.carry([lyingPack]);
  await sleep(200);
  ann.send({ t: 'drop', l: { uid: lyingPack.uid, item: lyingPack, x: 30.5, y: ground(30.5, 0.3), z: 0.3, rot: 0, point: -1, spawnedAt: 0 } });
  ann.carry([]);
  await sleep(300);
  ann.got.length = 0;
  bob.got.length = 0;
  ann.send({ t: 'lopen', uids: [lyingPack.uid] });
  bob.send({ t: 'lopen', uids: [lyingPack.uid] });
  assert.ok((await ann.heard('ldata')) && (await bob.heard('ldata')), 'both did not get what is in the pack');
  assert.ok(!bob.got.some((m) => m.t === 'lbusy'), 'Bob was told somebody else was going through it');
  ann.send({ t: 'lops', uid: lyingPack.uid, ops: [{ o: 'take', uid: 'sb-band' }] });
  await sleep(150);
  bob.send({ t: 'lops', uid: lyingPack.uid, ops: [{ o: 'take', uid: 'sb-band' }, { o: 'take', uid: 'sb-stim' }] });
  const lno = await bob.heard('cno', (m) => m.l === lyingPack.uid);
  assert.deepEqual(lno?.took.map((t) => t.uid), ['sb-band'], 'the second to take the bandage out of the pack was not told it was gone');
  const lc = bob.got.filter((m): m is Extract<S2C, { t: 'lcargo' }> => m.t === 'lcargo' && m.uid === lyingPack.uid).pop();
  assert.deepEqual((lc?.items ?? [{}] as StoredItem[]).map((it) => it.uid), [], 'the pack still holds something after both took');
  ok('a pack lying on the ground is gone through by two at once: each keeps what they took first, the second told of what was gone');
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) throw failed;
console.log(`${checks} checks passed`);
