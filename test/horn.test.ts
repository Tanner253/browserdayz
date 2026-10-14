// A car's horn and a police car's siren (src/game/horns.ts, 'vhorn' in server/handle.ts): the driver's are passed to
// everybody else; nobody else's are; a siren only on a police car, and somebody who comes later is told it is going.
// The real server on a port of its own.   npx tsx test/horn.test.ts
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { POLICE_CAR } from '../src/sim/vehicles';

const PORT = 8223;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type V = { i: number; k?: number; s: number[]; siren?: boolean };

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `horn-${this.name}`.padEnd(40, '0'), name: this.name }));
    for (let k = 0; k < 300 && !this.welcome; k++) await sleep(50);
    assert.ok(this.welcome, `${this.name} was not let in`);
  }
  get welcome() { return this.got.find((m) => m.t === 'welcome') as unknown as { you: number; vehicles: V[] } | undefined; }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  at(x: number, y: number, z: number) { this.send({ t: 's', p: [x, y, z, 0, 0, 1], w: null, m: [] }); }
  horns() { return this.got.filter((m) => m.t === 'vhorn') as unknown as { i: number; horn?: boolean; siren?: boolean }[]; }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-horn-'));
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
  const driver = new Player('Driver'), rider = new Player('Rider'), other = new Player('Other');
  for (const p of [driver, rider, other]) await p.join();
  const cop = driver.welcome!.vehicles.find((v) => v.k === POLICE_CAR.kind)!, jeep = driver.welcome!.vehicles.find((v) => !v.k)!;
  assert.ok(cop && jeep, 'no police car or no jeep');
  const [x, y, z] = cop.s;
  for (const p of [driver, rider, other]) p.at(x + 1, y - 0.8, z + 1);
  await sleep(300);
  driver.send({ t: 'vin', i: cop.i, seat: 0 });
  rider.send({ t: 'vin', i: cop.i, seat: 1 });
  await sleep(400);

  driver.send({ t: 'vhorn', i: cop.i, horn: true });
  await sleep(150);
  driver.send({ t: 'vhorn', i: cop.i, horn: false });
  driver.send({ t: 'vhorn', i: cop.i, siren: true });
  await sleep(400);
  assert.deepEqual(other.horns(), [{ t: 'vhorn', i: cop.i, horn: true }, { t: 'vhorn', i: cop.i, horn: false }, { t: 'vhorn', i: cop.i, siren: true }]);
  assert.equal(driver.horns().length, 0, 'the driver was told of their own horn');
  console.log(`  ok  ${++n}. the driver's horn, pressed and let go, and the police car's siren, reach everybody else`);

  // the one beside them cannot; a jeep has no siren (a horn, yes, for whoever drives it)
  other.got.length = 0;
  rider.send({ t: 'vhorn', i: cop.i, horn: true });
  driver.send({ t: 'vout' });
  await sleep(300);
  driver.at(jeep.s[0] + 1, jeep.s[1] - 0.8, jeep.s[2] + 1);
  await sleep(300);
  driver.send({ t: 'vin', i: jeep.i, seat: 0 });
  await sleep(400);
  driver.send({ t: 'vhorn', i: jeep.i, siren: true });
  driver.send({ t: 'vhorn', i: jeep.i, horn: true });
  await sleep(400);
  assert.deepEqual(other.horns(), [{ t: 'vhorn', i: jeep.i, horn: true }]);
  console.log(`  ok  ${++n}. nobody but the driver sounds it, and a jeep has a horn and no siren`);

  // and somebody who comes later hears the siren that is going
  const late = new Player('Late');
  await late.join();
  assert.equal(late.welcome!.vehicles.find((v) => v.i === cop.i)?.siren, true, 'a newcomer is not told the siren is going');
  assert.equal(late.welcome!.vehicles.find((v) => v.i === jeep.i)?.siren, undefined);
  console.log(`  ok  ${++n}. somebody who comes later is told the police car's siren is going`);
  for (const p of [driver, rider, other, late]) p.ws.close();
} catch (e) {
  failed = e;
} finally {
  if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error(failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log(`horn: ${n} passed`);
process.exit(0);
