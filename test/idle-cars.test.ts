// The west's jeeps on the real server, and cars left alone (JEEP.idle, server/acts.ts leftAlone): a jeep stands at
// each place of the west from the start; one that burns comes back at its place; one nobody has sat at the wheel of
// for CAR_IDLE_S is taken away, but not while anybody is near it or in it, nor while it stands at its own place,
// and a new one is stood there in its time. The real server is started on a port of its own, with the times short.
//   npx tsx test/idle-cars.test.ts
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { WEST_CARS } from '../src/sim/vehicles';

const PORT = 8253, IDLE = 4, RESPAWN = 2;
/** the middles of the places of the west, as the brief gave them */
const PLACES: Record<string, [number, number]> = { Pokrov: [-1850, -30], Zavod: [-2720, -360], Karavan: [-2905, -175], Blokpost: [-2930, 110], Kalat: [-3215, 230], Peski: [-3470, 70], Bereg: [-3520, -380], Mys: [-3520, 500] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Car = { i: number; k?: number; s: number[]; hp: number };

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `idle-cars-${this.name}`.padEnd(40, '0'), name: this.name }));
    for (let k = 0; k < 300 && !this.welcome; k++) await sleep(50);
    assert.ok(this.welcome, `${this.name} was not let in`);
  }
  get welcome() { return this.got.find((m) => m.t === 'welcome') as unknown as { you: number; vehicles: Car[] } | undefined; }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  at(x: number, y: number, z: number) { this.send({ t: 's', p: [x, y, z, 0, 0, 1], w: null, m: [] }); }
  /** whether the server has said this car was taken away */
  gone(i: number) { return this.got.some((m) => m.t === 'v-' && m.i === i); }
  /** a car stood since `from` (an index into what was heard), within a metre of x, z */
  stood(from: number, x: number, z: number) { return this.got.slice(from).find((m): m is Extract<S2C, { t: 'v+' }> => m.t === 'v+' && Math.hypot(m.v.s[0] - x, m.v.s[2] - z) < 1); }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-idle-cars-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, BOTCHECK: 'off', CHECKS: 'off', LINGER_S: '0', CAR_IDLE_S: String(IDLE), JEEP_RESPAWN_S: String(RESPAWN) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let n = 0;
let failed: unknown = null;
const pass = (what: string) => { n++; console.log('  ok  ' + what); };
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), 'the server did not start');
  const a = new Player('Driver');
  await a.join();
  const cars = a.welcome!.vehicles;

  // A jeep at each place of the west from the start (westSpots: by the road, a jeep, not a police car or a helicopter)
  const west = WEST_CARS.map(({ name, from }) => {
    const [x, z] = PLACES[name];
    const car = cars.filter((c) => !c.k && c.hp > 0).sort((p, q) => Math.hypot(p.s[0] - x, p.s[2] - z) - Math.hypot(q.s[0] - x, q.s[2] - z))[0];
    const d = Math.hypot(car.s[0] - x, car.s[2] - z);
    assert.ok(d < (from ? 240 : 130), `no jeep by ${name}: the nearest is ${d.toFixed(0)} m off`);
    return car;
  });
  assert.equal(new Set(west.map((c) => c.i)).size, WEST_CARS.length, 'one jeep counted for two places');
  pass(`a jeep at each of the ${WEST_CARS.length} places of the west (${WEST_CARS.map((w) => w.name).join(', ')})`);

  /** sit at the wheel of a car, move it `ahead` metres along its nose, and get out */
  const drive = async (car: Car, ahead: number) => {
    const [x, y, z, qx, qy, qz, qw] = car.s, yaw = 2 * Math.atan2(qy, qw);
    a.at(x + 1, y - 0.8, z);
    await sleep(300);
    a.send({ t: 'vin', i: car.i, seat: 0 });
    await sleep(300);
    const sat = [...a.got].reverse().find((m) => m.t === 'vseat' && m.i === car.i) as Extract<S2C, { t: 'vseat' }> | undefined;
    assert.ok(sat && sat.seats[0] === a.welcome!.you, `could not take the wheel of car ${car.i}`);
    const to = [x - Math.sin(yaw) * ahead, y, z - Math.cos(yaw) * ahead];
    for (let k = 1; k <= 5; k++) { a.send({ t: 'v', i: car.i, s: [x + ((to[0] - x) * k) / 5, y, z + ((to[2] - z) * k) / 5, qx, qy, qz, qw, 0, 0, 0, 0, 0.5], at: Date.now() }); await sleep(60); }
    const rest = [to[0], y, to[2], qx, qy, qz, qw, 0, 0, 0, 0, 0];
    a.send({ t: 'vrest', i: car.i, s: rest });
    await sleep(100);
    // (out, and it is left standing: the game that moved it says it is at rest)
    a.send({ t: 'vout' });
    await sleep(200);
    a.send({ t: 'vrest', i: car.i, s: rest });
    return to;
  };

  // Left alone near somebody, and with somebody in it: it stays. Left alone with nobody near: taken away, and a new one at its place.
  {
    const car = west[0], [hx, , hz] = car.s;
    const to = await drive(car, 40);
    a.at(to[0] + 30, to[1], to[2]);
    await sleep((IDLE + 3) * 1000);
    assert.ok(!a.gone(car.i), 'taken away with somebody 30 m off');
    pass(`left alone ${IDLE + 3} s (CAR_IDLE_S ${IDLE}) with somebody 30 m off: it stays`);

    a.at(to[0] + 1, to[1] - 0.8, to[2]);
    await sleep(300);
    a.send({ t: 'vin', i: car.i, seat: 2 });
    await sleep(300);
    a.at(to[0] + 400, to[1], to[2] + 400);
    await sleep((IDLE + 2) * 1000);
    assert.ok(!a.gone(car.i), 'taken away with somebody sitting in it');
    pass('with somebody in a back seat: it stays');

    const heard = a.got.length;
    a.send({ t: 'vout' });
    await sleep(200);
    a.at(to[0] + 400, to[1], to[2] + 400);
    for (let k = 0; k < 40 && !a.gone(car.i); k++) await sleep(100);
    assert.ok(a.gone(car.i), 'not taken away with nobody near');
    assert.ok(logged.includes(`car #${car.i} left alone`), 'the server did not say why it went');
    pass('with nobody in it and nobody within 150 m: taken away');

    let fresh;
    for (let k = 0; k < (RESPAWN + 5) * 10 && !(fresh = a.stood(heard, hx, hz)); k++) await sleep(100);
    assert.ok(fresh, 'no new car at its place');
    assert.ok(!fresh.v.k && fresh.v.hp > 0 && fresh.v.i !== car.i, 'what was stood is not a new jeep');
    pass(`and a new jeep at its place ${RESPAWN} s on (JEEP_RESPAWN_S)`);
  }

  // Burned: a new one at its place.
  {
    const car = west[1], [hx, , hz] = car.s;
    const to = await drive(car, 30);
    a.at(to[0] + 1, to[1] - 0.8, to[2]);
    await sleep(300);
    // (knocks too soft to hurt anybody in it: eleven metres a second, 63 off the car each; sent by the game moving it)
    a.send({ t: 'vin', i: car.i, seat: 0 });
    await sleep(300);
    for (let k = 0; k < 90; k++) { a.send({ t: 'vcrash', i: car.i, n: 11 }); await sleep(8); }
    a.send({ t: 'vout' });
    await sleep(200);
    a.at(to[0] + 60, to[1], to[2] + 60);
    const heard = a.got.length;
    for (let k = 0; k < 150 && !a.got.some((m) => m.t === 'vboom' && m.i === car.i); k++) await sleep(100);
    assert.ok(a.got.some((m) => m.t === 'vboom' && m.i === car.i), 'it did not burn');
    let fresh;
    for (let k = 0; k < (RESPAWN + 5) * 10 && !(fresh = a.stood(heard, hx, hz)); k++) await sleep(100);
    assert.ok(fresh && !fresh.v.k && fresh.v.hp > 0, 'no new jeep at its place after it burned');
    pass('a west jeep that burns: a new one at its place');
  }

  // Every car nobody touched, standing at its own place all this while (well past CAR_IDLE_S), is there still.
  const touched = new Set([west[0].i, west[1].i]);
  const lost = cars.filter((c) => !touched.has(c.i) && a.gone(c.i));
  assert.deepEqual(lost.map((c) => c.i), [], 'cars standing at their own places were taken away');
  pass(`the ${cars.length - touched.size} cars standing at their own places: none taken away`);
} catch (e) {
  failed = e;
} finally {
  if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error(failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log(`idle-cars: ${n} passed`);
process.exit(0);
