// A locker's doors stand open for as long as somebody is searching it, and everybody is told (server/index.ts
// 'copen', 'cclose' and `ajar`; src/net/protocol.ts 'cdoor' and the welcome's `ajar`; src/game/lockers.ts draws it;
// 2026-10-13: "lockers for example when opened should have their door crack open, and other people on the server
// could see that"). The model first: that its two doors are pieces of their own, each hung by its right-hand edge;
// and the wooden crate's lid, which lifts the same way. Then the real server on a port of its own, with four
// players. About twenty seconds.
//   npx tsx test/lockers.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, crateId, type S2C } from '../src/net/protocol';
import { CRATE_SPECS, HUNG } from '../src/sim/crates';
import { SEARCHED_KINDS } from '../src/world/buildings';
import { buildWorldData } from '../server/world';

const PORT = 8207;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (name: string) => {
  checks++;
  console.log('  ok  ' + name);
};

// ---- the model: a case and two doors, each a piece of its own whose origin is the line of its hinges
{
  const rule = HUNG.steel_locker;
  assert.ok(rule && rule.open > 1.5 && rule.open < 1.9 && rule.time > 0.3 && rule.time < 0.8, 'no rule for the steel locker\'s doors, or one that does not open them wide in about half a second');
  assert.ok(SEARCHED_KINDS.has('steel_locker') && CRATE_SPECS.steel_locker, 'the steel locker is not searched');
  const file = readFileSync(path.join(process.cwd(), 'public', 'assets', 'models', 'steel_locker.glb'));
  // (a .glb is a header of twelve bytes, then its description as JSON: how long that is, what it is, and the text)
  const json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString('utf8')) as { nodes: { name?: string; translation?: number[]; children?: number[]; mesh?: number }[]; scenes: { nodes: number[] }[] };
  const top = json.scenes[0].nodes.map((i) => json.nodes[i]);
  const leaves = top.filter((n) => rule.leaf.test(n.name ?? ''));
  const still = top.filter((n) => !rule.leaf.test(n.name ?? ''));
  assert.equal(leaves.length, 2, `${leaves.length} doors on the locker`);
  assert.ok(still.length >= 1 && still.every((n) => n.mesh !== undefined), 'the locker has no case apart from its doors');
  for (const leaf of leaves) {
    // (the hinge is a piece with no shape, at the locker's foot before its front; the door's shapes hang under it, named as it is)
    assert.ok(leaf.mesh === undefined && leaf.children?.length, `${leaf.name} is not a hinge with the door under it`);
    for (const k of leaf.children!) assert.ok(rule.leaf.test(json.nodes[k].name ?? '') && json.nodes[k].mesh !== undefined, `${leaf.name}: what hangs under it is not named as a door`);
    const [x, y, z] = leaf.translation ?? [0, 0, 0];
    assert.ok(Math.abs(y) < 1e-3 && z > 0.15 && z < 0.3, `${leaf.name} is hung at y ${y}, z ${z}`);
    // each of the two lockers in the case is half a metre wide: its door's hinges are at that locker's right-hand side
    const mid = /_l$/.test(leaf.name!) ? -0.27 : 0.27;
    assert.ok(x > mid + 0.2 && x < mid + 0.27, `${leaf.name} is not hung by its right-hand edge: its hinges are at x ${x}`);
  }
  ok('the steel locker is a case and two doors, each door a piece of its own hung by its right-hand edge');

  // and the wooden crate, whose lid came as a piece of its own: turned about a line across the crate, at the lid's
  // upper back edge, to a little short of upright (so that it does not go back past the crate into a wall)
  const lid = HUNG.wooden_crate_01;
  assert.ok(lid && lid.about === 'x' && lid.at && lid.open < -1.2 && lid.open > -Math.PI / 2, 'no rule for the wooden crate\'s lid, or one that throws it back past upright');
  const crate = readFileSync(path.join(process.cwd(), 'public', 'assets', 'models', 'wooden_crate_01.glb'));
  const cj = JSON.parse(crate.subarray(20, 20 + crate.readUInt32LE(12)).toString('utf8')) as typeof json;
  const names = cj.scenes[0].nodes.map((i) => cj.nodes[i].name ?? '');
  assert.equal(names.filter((n) => lid.leaf.test(n)).length, 1, `the wooden crate's lid is not one piece of its own: ${names.join(', ')}`);
  assert.ok(names.some((n) => !lid.leaf.test(n)), 'the wooden crate is nothing but a lid');
  const m = (JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'assets', 'manifest.json'), 'utf8')) as { models: Record<string, { min: number[]; max: number[] }> }).models.wooden_crate_01;
  // (the line is said in the model's own space: at its back, and at its very top, which is the lid's)
  assert.ok(Math.abs(lid.at[2] - m.min[2]) < 0.005 && Math.abs(lid.at[1] - m.max[1]) < 0.005, `the lid's hinges are not along the crate's upper back edge: ${lid.at}`);
  ok('the wooden crate\'s lid is a piece of its own, hinged along the crate\'s upper back edge');
}

// ---- where they stand
const data = buildWorldData(process.cwd());
const lockers = data.crates.filter((c) => c.kind === 'steel_locker');
{
  assert.ok(lockers.length >= 25, `only ${lockers.length} steel lockers on the map`);
  assert.equal(new Set(lockers.map((c) => c.cid)).size, lockers.length, 'two lockers go by one number');
  const within = (c: { x: number; z: number }, type: string, r: number) => data.buildings.some((b) => b.type.startsWith(type) && Math.hypot(b.x - c.x, b.z - c.z) < r);
  for (const [type, r, least] of [['police', 17, 9], ['hospital', 22, 4], ['barracks', 8, 6], ['hut', 8, 8]] as const) {
    const n = lockers.filter((c) => within(c, type, r)).length;
    assert.ok(n >= least, `${n} lockers in the ${type} buildings`);
  }
  ok(`${lockers.length} lockers stand on the map: with the police, in the hospital, in the barracks and the long huts`);
}

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public name: string, public key = `lockers-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
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
    this.send({ t: 's', p: [x, data.groundAt(x, z), z, 0, 0, 0], w: null, m: [] });
  }
  last<T extends S2C['t']>(t: T) {
    return this.got.filter((m) => m.t === t).pop() as Extract<S2C, { t: T }> | undefined;
  }
  /** what this player has been told of one container's doors, in the order it was said */
  doors(cid: string) {
    return this.got.filter((m): m is Extract<S2C, { t: 'cdoor' }> => m.t === 'cdoor' && m.cid === cid).map((m) => m.open);
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-lockers-'));
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
  // two lockers that stand side by side (in the headquarters' locker room there are three in a row)
  const one = lockers.find((a) => lockers.some((b) => b !== a && Math.hypot(a.x - b.x, a.z - b.z) < 1.6))!;
  const two = lockers.find((b) => b !== one && Math.hypot(one.x - b.x, one.z - b.z) < 1.6)!;
  assert.ok(one && two, 'no two lockers stand side by side');
  assert.equal(one.cid, crateId(one.x, one.z));
  // Ann at the lockers, Bob in the same room, Cat on the far side of the map
  const ann = new Player('Ann'), bob = new Player('Bob'), cat = new Player('Cat');
  for (const p of [ann, bob, cat]) assert.ok(await p.join());
  for (const p of [ann, bob, cat]) assert.deepEqual(p.last('welcome')!.ajar, [], `${p.name} came into a world with a locker standing open`);
  ann.say(one.x + 0.8, one.z);
  bob.say(one.x + 3, one.z + 2);
  cat.say(one.x > 0 ? -400 : 400, 300);
  await sleep(300);

  // ---- opened: whoever opened it is shown what is in it, and everybody is told its doors are open
  ann.send({ t: 'copen', cid: one.cid });
  await sleep(300);
  assert.equal(ann.last('cdata')?.cid, one.cid, 'the locker was not opened');
  for (const p of [ann, bob, cat]) assert.deepEqual(p.doors(one.cid), [true], `${p.name} was not told the locker stands open`);
  ok('one player opens a locker: they are shown what is in it, and they, the player beside them and one across the map are told its doors are open');

  // ---- while it is being searched nobody else has it, and nothing more is said of its doors; asked for again by
  // whoever has it, nothing more is said either
  bob.say(one.x + 1, one.z + 0.5);
  await sleep(150);
  bob.send({ t: 'copen', cid: one.cid });
  ann.send({ t: 'copen', cid: one.cid });
  await sleep(300);
  assert.equal(bob.last('cbusy')?.cid, one.cid, 'two players are searching one locker');
  assert.equal(ann.got.filter((m) => m.t === 'cdata').length, 2, 'whoever has it open was not told again what is in it');
  for (const p of [ann, bob, cat]) assert.deepEqual(p.doors(one.cid), [true], `${p.name} was told of the doors again`);
  // and somebody who comes in now finds it standing open
  const dee = new Player('Dee');
  assert.ok(await dee.join());
  assert.deepEqual(dee.last('welcome')!.ajar, [one.cid], 'somebody who came in while it was being searched is not shown it open');
  ok('while it is searched nobody else has it and nothing more is said of its doors; somebody who comes in meanwhile is told it stands open');

  // ---- on to the locker beside it without shutting the first: the first shuts, the second opens
  ann.send({ t: 'copen', cid: two.cid });
  await sleep(300);
  for (const p of [ann, bob, cat, dee]) {
    assert.deepEqual(p.doors(one.cid).slice(-1), [false], `${p.name} was not told the first locker is shut`);
    assert.deepEqual(p.doors(two.cid), [true], `${p.name} was not told the second locker stands open`);
  }
  // ---- done with it: it shuts, for everybody
  ann.send({ t: 'cclose', cid: two.cid });
  await sleep(300);
  for (const p of [ann, bob, cat, dee]) assert.deepEqual(p.doors(two.cid), [true, false], `${p.name} was not told the locker is shut`);
  const eve = new Player('Eve');
  assert.ok(await eve.join());
  assert.deepEqual(eve.last('welcome')!.ajar, [], 'somebody who came in after it was shut is shown it open');
  eve.ws.close();
  ok('moving on to the next locker shuts the first and opens the second; done with it, it shuts; and everybody is told each time');

  // ---- whoever is searching one and leaves the game leaves it shut behind them
  bob.send({ t: 'copen', cid: one.cid });
  await sleep(300);
  assert.equal(bob.last('cdata')?.cid, one.cid, 'the locker cannot be opened once the first to search it is done');
  assert.deepEqual(cat.doors(one.cid), [true, false, true]);
  bob.ws.close();
  await sleep(600);
  for (const p of [ann, cat]) assert.deepEqual(p.doors(one.cid), [true, false, true, false], `${p.name} was not told the locker shut when the player searching it left`);
  // (Dee came in while it stood open the first time: that much she had from her welcome)
  assert.deepEqual(dee.doors(one.cid), [false, true, false], 'Dee was not told the locker shut when the player searching it left');
  ok('a player who leaves the game with a locker open leaves it shut: everybody is told');

  // ---- from too far off nothing is opened, and nothing is said
  cat.send({ t: 'copen', cid: two.cid });
  await sleep(300);
  assert.equal(cat.got.filter((m) => m.t === 'cdata').length, 0, 'a locker was opened from across the map');
  for (const p of [ann, cat, dee]) assert.deepEqual(p.doors(two.cid), [true, false], `${p.name} was told a locker opened that nobody is at`);
  ok('nothing is opened from across the map, and nothing is said of it');

  // ---- a wooden crate is told of in the same words: its lid is seen to lift
  const crate = data.crates.find((c) => c.kind === 'wooden_crate_01' && data.crates.filter((o) => o.cid === c.cid).length === 1)!;
  ann.say(crate.x + 0.7, crate.z);
  await sleep(200);
  ann.send({ t: 'copen', cid: crate.cid });
  await sleep(300);
  assert.equal(ann.last('cdata')?.cid, crate.cid, 'the crate was not opened');
  for (const p of [ann, cat, dee]) assert.deepEqual(p.doors(crate.cid), [true], `${p.name} was not told the crate stands open`);
  ann.send({ t: 'cclose', cid: crate.cid });
  await sleep(300);
  for (const p of [ann, cat, dee]) assert.deepEqual(p.doors(crate.cid), [true, false], `${p.name} was not told the crate is shut`);
  ok('a wooden crate opened and shut is told of in the same way');
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(400);
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
