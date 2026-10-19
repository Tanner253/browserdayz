// A helicopter that goes up in the air comes down (server/acts.ts, `dropWreck`): the game of whoever is nearest is
// handed the wreck to let it fall, and what that game says of it is passed on to everybody until it is down; with
// nobody near, the server sets it down under where it went up (the owner, 2026-10-19: "when a helicopter explodes in
// mid air it just stays there and does not tumble to the ground like it should"). The real server on a port of its own.
//   npx tsx test/heli-wreck.test.ts
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { HELI } from '../src/sim/heli';

const PORT = 8273;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `heli-wreck-${this.name}`.padEnd(40, '0'), name: this.name }));
    for (let k = 0; k < 300 && !this.welcome; k++) await sleep(50);
    assert.ok(this.welcome, `${this.name} was not let in`);
  }
  get welcome() { return this.got.find((m) => m.t === 'welcome') as unknown as { you: number; vehicles: { i: number; k?: number; s: number[]; hp: number }[] } | undefined; }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  at(x: number, y: number, z: number) { this.send({ t: 's', p: [x, y, z, 0, 0, 1], w: null, m: [] }); }
  all<T>(t: string): T[] { return this.got.filter((m) => m.t === t) as T[]; }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-heli-wreck-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, BOTCHECK: 'off', CHECKS: 'off', LINGER_S: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let n = 0;
let failed: unknown = null;
/** a pilot takes the helicopter sixty metres up and wrecks it there, by telling the server it hit something, hard, again and again */
async function wreckUp(pilot: Player, heli: { i: number; s: number[] }) {
  const [x, y, z] = heli.s;
  pilot.at(x + 1, y - 0.8, z);
  // (what they carry and how they are, as every game says: the blast in the seat is the end of them)
  pilot.send({ t: 'me', inv: { slots: {}, active: null, containers: [] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  await sleep(300);
  pilot.send({ t: 'vin', i: heli.i, seat: 0 });
  await sleep(400);
  const up = [x, y + 60, z, ...heli.s.slice(3, 7), 0, 0, 0, 0, 0.6];
  for (let k = 0; k < 5; k++) { pilot.send({ t: 'v', i: heli.i, s: up, at: Date.now() }); await sleep(60); }
  for (let k = 0; k < 30 && !pilot.all('vboom').length; k++) { pilot.send({ t: 'vcrash', i: heli.i, n: 40 }); await sleep(80); }
  assert.ok(pilot.all('vboom').length, 'the helicopter did not go up');
}
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), 'the server did not start');

  const pilot = new Player('Pilot'), friend = new Player('Friend'), watcher = new Player('Watcher');
  await pilot.join();
  await friend.join();
  await watcher.join();
  const heli = pilot.welcome!.vehicles.find((v) => v.k === HELI.kind && v.s[2] < 0)!;
  assert.ok(heli, 'no helicopter by the fort');
  const [x, y, z] = heli.s;
  friend.at(x + 6, y - 0.8, z + 6);
  watcher.at(x + 40, y - 0.8, z + 40);
  await wreckUp(pilot, heli);
  await sleep(300);
  // handed to the nearest game that is alive: the friend's (the pilot died in it)
  const seat = friend.all<{ i: number; sim: number | null }>('vseat').filter((m) => m.i === heli.i).pop();
  assert.equal(seat?.sim, friend.welcome!.you, `the wreck was not handed to the game nearest it: ${JSON.stringify(seat)}`);
  console.log(`  ok  ${++n}. gone up sixty metres up: the wreck is handed to the nearest game to let fall`);
  // what that game says of it as it falls is passed on to everybody
  watcher.got.length = 0;
  for (let k = 1; k <= 10; k++) {
    friend.send({ t: 'v', i: heli.i, s: [x, y + 60 - 6 * k, z, ...heli.s.slice(3, 7), 0, -12, 0, 0, 0], at: Date.now() });
    await sleep(60);
  }
  await sleep(200);
  const seen = watcher.all<{ s: number[][] }>('vs').flatMap((m) => m.s).filter((s) => s[0] === heli.i);
  assert.ok(seen.length >= 5, `its fall was not passed on: ${seen.length} reports`);
  console.log(`  ok  ${++n}. its fall is passed on to everybody (${seen.length} reports)`);
  friend.send({ t: 'vrest', i: heli.i, s: [x, y, z, ...heli.s.slice(3, 7), 0, 0, 0, 0, 0] });
  await sleep(300);
  const rest = watcher.all<{ i: number; sim: number | null; s?: number[] }>('vseat').filter((m) => m.i === heli.i).pop();
  assert.ok(rest && rest.sim === null && rest.s && Math.abs(rest.s[1] - y) < 0.5, `not left lying where it came down: ${JSON.stringify(rest)}`);
  console.log(`  ok  ${++n}. down: it lies where it came down`);

  // nobody near: the server sets the wreck down under where it went up
  const solo = new Player('Solo');
  await solo.join();
  const roof = solo.welcome!.vehicles.find((v) => v.k === HELI.kind && v.s[1] > 85 && v.hp > 0)!;
  assert.ok(roof, 'no helicopter on the hospital roof');
  for (const p of [friend, watcher]) p.at(roof.s[0] - 1500, 60, roof.s[2]);
  await sleep(300);
  watcher.got.length = 0;
  await wreckUp(solo, roof);
  await sleep(400);
  const down = watcher.all<{ i: number; sim: number | null; s?: number[] }>('vseat').filter((m) => m.i === roof.i).pop();
  assert.ok(down && down.sim === null && down.s && down.s[1] < roof.s[1] + 5, `with nobody near it was left in the air: ${JSON.stringify(down)}`);
  console.log(`  ok  ${++n}. with nobody near, the server sets it down under where it went up (y ${down.s![1].toFixed(1)})`);
  for (const p of [pilot, friend, watcher, solo]) p.ws.close();
} catch (e) {
  failed = e;
} finally {
  if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error(failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log(`heli-wreck: ${n} passed`);
process.exit(0);
