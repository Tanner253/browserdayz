// A pilot whose line drops in the air keeps the seat (server/gate.ts, SEAT_HOLD_MS): the helicopter hangs where it was,
// not handed to the nearest game or set down wrecked, and the same player back in the seat with its controls when their
// page comes back in by itself (live, 2026-10-27: a pilot's body fell 84 m and they came back to die of it). The real
// server is started on a port of its own.   npx tsx test/seat-hold.test.ts
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { HELI } from '../src/sim/heli';

const PORT = 8405;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Seats = { i: number; seats: (number | null)[]; sim: number | null };

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string) {}
  async join() {
    this.got = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `seat-hold-${this.name}`.padEnd(40, '0'), name: this.name }));
    for (let k = 0; k < 300 && !this.welcome; k++) await sleep(50);
    assert.ok(this.welcome, `${this.name} was not let in`);
  }
  get welcome() { return this.got.find((m) => m.t === 'welcome') as unknown as { you: number; vehicles: { i: number; k?: number; s: number[]; hp: number }[] } | undefined; }
  seats(i: number) { return this.got.filter((m) => m.t === 'vseat' && (m as unknown as Seats).i === i).pop() as unknown as Seats | undefined; }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  at(x: number, y: number, z: number) { this.send({ t: 's', p: [x, y, z, 0, 0, 1], w: null, m: [] }); }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-seathold-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  // (a body left at once: no first minute in the world to wait out)
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, BOTCHECK: 'off', CHECKS: 'off', FRESH_S: '0.001' },
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

  const pilot = new Player('Pilot'), watcher = new Player('Watch');
  await pilot.join();
  await watcher.join();
  const heli = pilot.welcome!.vehicles.find((v) => v.k === HELI.kind && v.hp > 0)!;
  assert.ok(heli, 'no helicopter');
  const [x, y, z] = heli.s;
  pilot.at(x + 1, y - 0.8, z);
  // (what they carry, as every game says it: a body with nothing said of it is nobody to come back to)
  pilot.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'pockets', items: [] }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false, blood: 5000, bleed: 0 } });
  // (a watcher 300 m off, near enough to be handed a helicopter left with nobody's game to move it)
  const mid = Math.hypot(x, z) || 1;
  watcher.at(x - (x / mid) * 300, 60, z - (z / mid) * 300);
  await sleep(400);
  pilot.send({ t: 'vin', i: heli.i, seat: 0 });
  await sleep(400);
  const first = pilot.welcome!.you;
  assert.ok(pilot.seats(heli.i)?.sim === first, 'the pilot did not get the seat');
  const up = [x, y + 60, z, ...heli.s.slice(3, 7), 0, 0, 0, 1, 0.6];
  for (let k = 0; k < 5; k++) { pilot.send({ t: 'v', i: heli.i, s: up, at: Date.now() }); await sleep(60); }

  // the line drops (1006, as a browser's does): the seat and the controls stay theirs, and nothing falls
  watcher.got.length = 0;
  pilot.ws.terminate();
  await sleep(2500);
  assert.ok(logged.includes('went without logging out'), 'no body was left');
  assert.ok(!watcher.got.some((m) => (m.t === 'vseat' && (m as unknown as Seats).i === heli.i) || (m.t === 'vboom' && (m as { i: number }).i === heli.i)), `the helicopter was let go: ${JSON.stringify(watcher.got.filter((m) => m.t === 'vseat' || m.t === 'vboom'))}`);
  console.log('  ok  a pilot whose line drops: the seat is held, the helicopter neither handed on nor brought down');
  n++;

  // back in, as the page does by itself: in the seat again, at its controls
  await pilot.join();
  const back = pilot.welcome!.you;
  assert.notEqual(back, first);
  for (let k = 0; k < 40 && pilot.seats(heli.i)?.sim !== back; k++) await sleep(50);
  const now = pilot.seats(heli.i);
  assert.ok(now && now.seats[0] === back && now.sim === back, `not back in the seat: ${JSON.stringify(now)}`);
  assert.ok(!now.seats.includes(first), 'the old body still holds a seat');
  console.log('  ok  back in: the same seat, the controls again');
  n++;
  pilot.ws.close();
  watcher.ws.close();
} catch (e) {
  failed = e;
} finally {
  if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error(failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log(`seat-hold: ${n} passed`);
process.exit(0);
