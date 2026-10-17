// A helicopter whose pilot leaves the game in the air, with nobody aboard (server/acts.ts, orphanHeli): with another
// player near, their game takes it over and everybody sees it fall; with nobody near, the server sets it down where it
// would have fallen, wrecked (the owner, 2026-10-14: "a solo pilot who disconnected would crash yes?"). The real server
// is started on a port of its own.   npx tsx test/heli-orphan.test.ts
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { HELI } from '../src/sim/heli';

const PORT = 8211;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `heli-orphan-${this.name}`.padEnd(40, '0'), name: this.name }));
    for (let k = 0; k < 300 && !this.welcome; k++) await sleep(50);
    assert.ok(this.welcome, `${this.name} was not let in`);
  }
  get welcome() { return this.got.find((m) => m.t === 'welcome') as unknown as { you: number; vehicles: { i: number; k?: number; s: number[]; hp: number }[] } | undefined; }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  at(x: number, y: number, z: number) { this.send({ t: 's', p: [x, y, z, 0, 0, 1], w: null, m: [] }); }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-heli-'));
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

  // the pilot takes the helicopter on the hospital roof up sixty metres, with a watcher who is either far or near
  const fly = async (watcherNear: boolean) => {
    const pilot = new Player(watcherNear ? 'PilotB' : 'PilotA'), watcher = new Player(watcherNear ? 'WatchB' : 'WatchA');
    await pilot.join();
    await watcher.join();
    // (the first time the one on the hospital's roof, the second the one by the fort: the first is a wreck by then)
    // (the fort's in the north of the map, the hospital's in the south)
    const heli = pilot.welcome!.vehicles.filter((v) => v.k === HELI.kind).find((v) => v.hp > 0 && (watcherNear ? v.s[2] < 0 : v.s[2] > 0))!;
    assert.ok(heli, 'no helicopter where one stands');
    const [x, y, z] = heli.s;
    pilot.at(x + 1, y - 0.8, z);
    // (the near watcher 300 m off TOWARD THE MAP'S MIDDLE: the fort's pad stands by the map's east edge since the
    // fort moved to the rim (2026-10-14), and a watcher 300 m east of it stood off the map, where the server takes
    // no word of anybody's place (isPose), so nobody was near)
    const mid = Math.hypot(x, z) || 1;
    watcher.at(watcherNear ? x - (x / mid) * 300 : x - 1000, 60, watcherNear ? z - (z / mid) * 300 : z - 400);
    await sleep(400);
    pilot.send({ t: 'vin', i: heli.i, seat: 0 });
    await sleep(400);
    const sat = pilot.got.find((m) => m.t === 'vseat' && (m as { i: number }).i === heli.i) as { seats: (number | null)[]; sim: number | null } | undefined;
    assert.ok(sat && sat.seats[0] === pilot.welcome!.you && sat.sim === pilot.welcome!.you, `the pilot did not get the seat: ${JSON.stringify(sat)} at ${heli.s.slice(0, 3).map(Math.round)}`);
    const up = [x, y + 60, z, ...heli.s.slice(3, 7), 0, 0, 0, 1, 0.6];
    for (let k = 0; k < 5; k++) { pilot.send({ t: 'v', i: heli.i, s: up, at: Date.now() }); await sleep(60); }
    const watcherId = watcher.welcome!.you;
    watcher.got.length = 0;
    pilot.ws.close();
    await sleep(1500);
    return { heli, watcher, watcherId };
  };

  {
    const { heli, watcher } = await fly(false);
    const boom = watcher.got.find((m) => m.t === 'vboom' && (m as { i: number }).i === heli.i);
    const seat = watcher.got.find((m) => m.t === 'vseat' && (m as { i: number }).i === heli.i) as { s?: number[]; sim: number | null } | undefined;
    assert.ok(boom, `nobody near: it was not wrecked (heard: ${watcher.got.map((m) => m.t).join(' ')})`);
    assert.ok(seat && seat.sim === null && seat.s && seat.s[1] < heli.s[1] + 2, 'nobody near: it was not set down');
    assert.ok(logged.includes(`the helicopter ${heli.i} came down`));
    console.log('  ok  a pilot who leaves in the air with nobody near: the server sets it down, wrecked');
    n++;
    watcher.ws.close();
  }
  {
    const { heli, watcher, watcherId } = await fly(true);
    const seat = watcher.got.find((m) => m.t === 'vseat' && (m as { i: number }).i === heli.i) as { sim: number | null } | undefined;
    assert.ok(seat && seat.sim === watcherId, `somebody near: their game did not take it over (heard: ${watcher.got.map((m) => m.t).join(' ')})`);
    assert.ok(!watcher.got.some((m) => m.t === 'vboom' && (m as { i: number }).i === heli.i), 'somebody near: it was wrecked by the server, not left to fall');
    console.log('  ok  a pilot who leaves in the air with somebody 300 m off: their game takes it over, and it falls for everybody');
    n++;
    watcher.ws.close();
  }
} catch (e) {
  failed = e;
} finally {
  if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error(failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log(`heli-orphan: ${n} passed`);
process.exit(0);
