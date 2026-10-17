// A pilot killed in the air (server/acts.ts, `riders`): the body stays in its seat, with all it carried, until the
// helicopter is down, and is then laid on the ground beside it to be searched (the owner, 2026-10-14: "their body
// should stay in the helicopter till it crashes then spawn on the ground with all the contents on the ground so they
// can be looted, currently the player just dies in the sky"). The real server on a port of its own.
//   npx tsx test/heli-body.test.ts
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type CorpseInfo, type S2C } from '../src/net/protocol';
import { HELI } from '../src/sim/heli';

const PORT = 8213;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `heli-body-${this.name}`.padEnd(40, '0'), name: this.name }));
    for (let k = 0; k < 300 && !this.welcome; k++) await sleep(50);
    assert.ok(this.welcome, `${this.name} was not let in`);
  }
  get welcome() { return this.got.find((m) => m.t === 'welcome') as unknown as { you: number; vehicles: { i: number; k?: number; s: number[]; hp: number }[] } | undefined; }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  at(x: number, y: number, z: number) { this.send({ t: 's', p: [x, y, z, 0, 0, 1], w: null, m: [] }); }
  heard<T>(t: string): T | undefined { return this.got.find((m) => m.t === t) as T | undefined; }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-heli-body-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, BOTCHECK: 'off', CHECKS: 'off', LINGER_S: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let n = 0;
let failed: unknown = null;
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), 'the server did not start');

  const pilot = new Player('Pilot'), friend = new Player('Friend');
  await pilot.join();
  await friend.join();
  // (the one by the fort, on the ground: in the north of the map, the hospital's in the south)
  const heli = pilot.welcome!.vehicles.find((v) => v.k === HELI.kind && v.s[2] < 0)!;
  assert.ok(heli, 'no helicopter by the fort');
  const [x, y, z] = heli.s;
  pilot.at(x + 1, y - 0.8, z);
  friend.at(x + 3, y - 0.8, z + 3);
  // (a rifle to leave on the body: a body with nothing on it is not left at all)
  pilot.send({ t: 'me', inv: { slots: { primary: { uid: 'heli-body-rifle', id: 'ak', qty: 1, loaded: 0, mag: null } }, active: null, containers: [] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  await sleep(400);
  pilot.send({ t: 'vin', i: heli.i, seat: 0 });
  await sleep(400);
  // sixty metres up, hanging still
  const up = [x, y + 60, z, ...heli.s.slice(3, 7), 0, 0, 0, 0, 0.6];
  for (let k = 0; k < 5; k++) { pilot.send({ t: 'v', i: heli.i, s: up, at: Date.now() }); await sleep(60); }
  pilot.send({ t: 'died', cause: 'shot', v: 0 });
  await sleep(2500);

  const death = friend.heard<{ corpse: CorpseInfo | null }>('death');
  assert.ok(death?.corpse, 'no body');
  assert.deepEqual(death.corpse.ride, { i: heli.i, seat: 0 }, 'the body does not ride the helicopter');
  const uid = death.corpse.uid;
  assert.equal(friend.heard('corpse@'), undefined, 'laid on the ground while the helicopter hangs sixty metres up');
  // (and not to be searched up there, from under it)
  friend.send({ t: 'copen', cid: uid });
  await sleep(400);
  assert.equal(friend.heard('cdata'), undefined, 'searched while still in the air');
  console.log(`  ok  ${++n}. killed sixty metres up: the body stays in its seat, not to be searched, while the helicopter hangs there`);

  // it comes down (the dead pilot's game moves it until it is at rest, as it would a car they got out of)
  for (let k = 1; k <= 10; k++) {
    pilot.send({ t: 'v', i: heli.i, s: [x, y + 60 - 6 * k, z, ...heli.s.slice(3, 7), 0, -12, 0, 0, 0], at: Date.now() });
    await sleep(60);
  }
  pilot.send({ t: 'vrest', i: heli.i, s: [x, y, z, ...heli.s.slice(3, 7), 0, 0, 0, 0, 0] });
  for (let k = 0; k < 40 && !friend.heard('corpse@'); k++) await sleep(100);
  const down = friend.heard<{ corpse: CorpseInfo }>('corpse@');
  assert.ok(down, 'the body was not laid on the ground when the helicopter came down');
  assert.equal(down.corpse.uid, uid);
  assert.equal(down.corpse.ride, undefined);
  const off = Math.hypot(down.corpse.x - x, down.corpse.z - z);
  assert.ok(off > 2 && off < 3, `laid ${off.toFixed(2)} m from the helicopter's middle`);
  assert.ok(Math.abs(down.corpse.y - (y - 0.8)) < 1.5, `laid at ${down.corpse.y.toFixed(1)}, the skids at ${(y - 0.8).toFixed(1)}`);
  console.log(`  ok  ${++n}. down: laid on the ground ${off.toFixed(1)} m out of the pilot's side`);

  // and searched there, with what they carried
  friend.at(down.corpse.x + 1, down.corpse.y, down.corpse.z);
  await sleep(300);
  friend.send({ t: 'copen', cid: uid });
  for (let k = 0; k < 20 && !friend.heard('cdata'); k++) await sleep(100);
  const data = friend.heard<{ cid: string; items: unknown[] }>('cdata');
  assert.ok(data && data.cid === uid && data.items.length > 0, `not searched on the ground: ${JSON.stringify(data)}`);
  console.log(`  ok  ${++n}. searched on the ground: ${data.items.length} things`);

  // and a newcomer is told of it where it lies, not in the air
  const late = new Player('Late');
  await late.join();
  const told = (late.welcome as unknown as { corpses: CorpseInfo[] }).corpses.find((c) => c.uid === uid);
  assert.ok(told && !told.ride && Math.abs(told.y - down.corpse.y) < 0.01, 'a newcomer is told of it in the air');
  console.log(`  ok  ${++n}. somebody who comes later finds it on the ground`);
  for (const p of [pilot, friend, late]) p.ws.close();
} catch (e) {
  failed = e;
} finally {
  if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error(failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log(`heli-body: ${n} passed`);
process.exit(0);
