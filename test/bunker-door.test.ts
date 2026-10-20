// Bunker 17's door and whoever is in it (the owner, 2026-10-19: "bunker is not suppsed to close with a player inside
// the bunker. if someone logs out in bunker or server restarts the server should spawn them on the surface outside the
// bunker. we dont want this loation being exploitable"). This tree's server, on a port of its own, with the door's
// minute cut to three seconds: it stays open while somebody is in its furthest room; whoever is in it while it is
// shut is set outside; and whoever left in it comes back outside, with what they carried.
// `npx tsx test/bunker-door.test.ts`

import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, bunkerPlace, heightAt } from '../src/world/worldgen';
import { BUNKER, bunkerAt, bunkerOutside, levelY } from '../src/sim/bunker';

const PORT = 8177, SHUT_S = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const P = bunkerPlace(world)!;
const floor = P.y + levelY();
// (the furthest room from the door, in its far corner; the foot of the stair, at the reader; out on the ground)
const far = bunkerAt(P, -BUNKER.hall.r + 1.5, BUNKER.hall.back + 1.5, levelY());
const reader = bunkerAt(P, 0, BUNKER.hall.front + 1.3, levelY());
const [ox, , oz] = bunkerOutside(P);
const away = [ox - 30, Math.max(heightAt(world.heights, ox - 30, oz), heightAt(world.surface, ox - 30, oz)), oz] as const;

let n = 0;
const ok = (name: string) => console.log(`  ok  ${++n} ${name}`);

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-bunker-door-'));
const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  // (an address where nothing answers for the site: nothing here reaches the live one; everybody on it an admin, to be put places)
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', LOCAL_ADMIN: '1', DATA_DIR: dir, BOTCHECK: 'off', INFECTED: 'off', LINGER_S: '0', BUNKER_SHUT_S: String(SHUT_S) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));

type Welcome = Extract<S2C, { t: 'welcome' }>;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  welcome: Welcome | null = null;
  at: [number, number, number] = [0, 0, 0];
  constructor(public key: string) {}
  async join() {
    this.got = [];
    this.welcome = null;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as S2C;
      this.got.push(m);
      if (m.t === 'welcome') this.welcome = m;
      // (as the game does: set down where the server puts it)
      if (m.t === 'put') this.at = [m.x, m.y ?? this.at[1], m.z];
    });
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: 'DoorTest' }));
    for (let k = 0; k < 300 && !this.welcome; k++) await sleep(50);
    // (set by the socket's listener: not narrowed away by the null above)
    const w = this.welcome as Welcome | null;
    assert.ok(w, `not let in: ${JSON.stringify(this.got).slice(0, 300)}`);
    const sp = w.spawn;
    this.at = [sp.x, sp.y ?? heightAt(world.heights, sp.x, sp.z), sp.z];
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  /** an admin's /tp, and the server's word of it awaited */
  async tp(x: number, y: number, z: number) {
    const before = this.got.length;
    this.send({ t: 'chat', text: `/tp ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}` });
    for (let k = 0; k < 60 && !this.got.slice(before).some((m) => m.t === 'put'); k++) await sleep(50);
    assert.ok(this.got.slice(before).some((m) => m.t === 'put'), 'the /tp was not done');
  }
  /** stand where it is for a while, saying so as a game does */
  async stay(ms: number) {
    for (let t = 0; t < ms; t += 150) {
      this.send({ t: 's', p: [this.at[0], this.at[1], this.at[2], 0, 0, 1], w: null, m: [] });
      await sleep(150);
    }
  }
  door(): boolean | null {
    const d = [...this.got].reverse().find((m) => m.t === 'bunker') as Extract<S2C, { t: 'bunker' }> | undefined;
    return d ? d.open : null;
  }
}

const end = () => { if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); };
let failed: unknown = null;
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
  const a = new Player('bunker-door-test-key'.padEnd(40, '0'));
  await a.join();
  assert.equal(a.welcome!.bunker, false);

  // 1. In the furthest room with the door shut (in by a gap, say): set outside it, on the ground
  await a.tp(far[0], floor + 0.05, far[2]);
  a.at = [far[0], floor + 0.05, far[2]];
  const before = a.got.length;
  await a.stay(4500);
  const put = a.got.slice(before).find((m) => m.t === 'put') as Extract<S2C, { t: 'put' }> | undefined;
  assert.ok(put, 'left shut in the bunker');
  assert.ok(Math.hypot(put.x - ox, put.z - oz) < 0.5 && put.y !== undefined && Math.abs(put.y - P.y) < 0.6, `set at ${put.x}, ${put.y}, ${put.z}, not before the house`);
  ok('found in it with its door shut: set on the ground before its house');

  // 2. Opened with a card, and it stays open for as long as somebody is in its furthest room, well past its minute
  a.send({ t: 'me', inv: { slots: {}, containers: [{ id: 'pockets', items: [{ uid: 'card-1', id: 'keycard', qty: 1, x: 0, y: 0, rot: false }] }], hot: [] } });
  await a.tp(reader[0], floor + 0.05, reader[2]);
  a.at = [reader[0], floor + 0.05, reader[2]];
  await a.stay(600);
  a.send({ t: 'bunker' });
  for (let k = 0; k < 40 && a.door() !== true; k++) await sleep(100);
  assert.equal(a.door(), true, 'the card did not open it');
  await a.tp(far[0], floor + 0.05, far[2]);
  a.at = [far[0], floor + 0.05, far[2]];
  await a.stay((SHUT_S + 4) * 1000);
  assert.equal(a.door(), true, 'it shut with somebody in its furthest room');
  ok(`open with somebody in its furthest room, ${SHUT_S + 4} s against a shut of ${SHUT_S} s`);

  // 3. Out of it, and it shuts
  await a.tp(away[0], away[1], away[2]);
  a.at = [away[0], away[1], away[2]];
  await a.stay((SHUT_S + 3) * 1000);
  assert.equal(a.door(), false, 'it did not shut once nobody was in it');
  ok('shut once nobody was left in it');

  // 4. Gone from the game down in it (the door open), and back: before its house, with what they carried
  await a.tp(reader[0], floor + 0.05, reader[2]);
  a.at = [reader[0], floor + 0.05, reader[2]];
  await a.stay(400);
  a.send({ t: 'bunker' });
  for (let k = 0; k < 40 && a.door() !== true; k++) await sleep(100);
  assert.equal(a.door(), true, 'the card did not open it the second time');
  await a.tp(far[0], floor + 0.05, far[2]);
  a.at = [far[0], floor + 0.05, far[2]];
  await a.stay(1200);
  a.ws.close();
  // (and the door shuts behind them, with nobody left in it: what they come back to)
  await sleep((SHUT_S + 3) * 1000);
  await a.join();
  const sp = a.welcome!.spawn;
  assert.ok(Math.hypot(sp.x - ox, sp.z - oz) < 0.5 && sp.y !== undefined && Math.abs(sp.y - P.y) < 0.6, `came back at ${sp.x}, ${sp.y}, ${sp.z}, not before the house`);
  assert.equal(a.welcome!.bunker, false, 'the door was not shut when they came back');
  assert.ok(JSON.stringify(a.welcome!.me?.inv ?? null).includes('keycard'), 'what they carried was not given back');
  ok('left in it, came back before its house with what they carried (the same as after a restart: one way back in)');
  a.ws.close();
  await sleep(300);
  const bad = logged.split('\n').filter((l) => /TypeError|ReferenceError|SyntaxError|RangeError|Unhandled|uncaught|\bat .*\.ts:\d+/i.test(l));
  assert.equal(bad.length, 0, `the server wrote what looks like a crash:\n${bad.slice(0, 10).join('\n')}`);
} catch (e) {
  failed = e;
} finally {
  end();
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) {
  console.error('FAILED:', failed instanceof Error ? failed.message : failed, '\n--- server log tail ---\n' + logged.slice(-1500));
  process.exit(1);
}
console.log(`${n} passed`);
process.exit(0);
