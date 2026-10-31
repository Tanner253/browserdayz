// Traps on the real server (server/traps.ts): one is set and told only to whoever is near it; it waits until it is armed,
// then a foot sets it off and it breaks a leg; a mine goes off, and what it kills is nobody's. The real server is started on
// a port of its own.   npx tsx test/traps-server.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { makeItem } from '../src/sim/items';
import { TRAPS, TRAP_KEEP } from '../src/sim/traps';

const PORT = 8421;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VITALS = { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false, blood: 5000, bleed: 0 };

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.send({ t: 'hello', v: PROTOCOL, key: `traps-${this.name}`.padEnd(40, '0'), name: this.name });
    for (let k = 0; k < 300 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    assert.ok(this.got.some((m) => m.t === 'welcome'), `${this.name} was not let in`);
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  at(x: number, y: number, z: number) { this.send({ t: 's', p: [x, y, z, 0, 0, 1], w: null, m: [] }); }
  carry(...ids: string[]) {
    const items = ids.map((id, k) => ({ ...makeItem(id, 1), x: k * 3, y: 0, rot: false }));
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'pockets', items }] }, vitals: VITALS });
    return items;
  }
  last<T extends S2C['t']>(t: T) { return this.got.filter((m) => m.t === t).pop() as Extract<S2C, { t: T }> | undefined; }
  async until(what: string, f: () => boolean, ms = 4000) {
    for (let k = 0; k < ms / 40 && !f(); k++) await sleep(40);
    assert.ok(f(), what);
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-traps-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, BOTCHECK: 'off', CHECKS: 'off', INFECTED: 'off', FRESH_S: '0.001' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let n = 0, failed: unknown = null;
const ok = (name: string) => {
  n++;
  console.log(`  ok  ${name}`);
};
try {
  for (let k = 0; k < 1800 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), 'the server did not start');
  const ann = new Player('Ann'), bob = new Player('Bob'), far = new Player('Far');
  await ann.join();
  await bob.join();
  await far.join();
  // (somewhere open in the valley, away from anybody's base)
  const X = 30, Y = 20, Z = 200;
  ann.at(X, Y, Z);
  bob.at(X + 20, Y, Z);
  far.at(X + 400, Y, Z);
  await sleep(300);

  const [trap] = ann.carry('bear_trap');
  await sleep(200);
  ann.send({ t: 'trap', k: 'bear_trap', uid: trap.uid, o: [X + 1, Y, Z], yaw: 0 });
  await ann.until('the setter was not told it was set', () => ann.last('trapok')?.uid === trap.uid);
  ok('a trap is set when its setter carries one, and they are told so');

  ann.send({ t: 'trap', k: 'land_mine', uid: 'none', o: [X + 1, Y, Z], yaw: 0 });
  await sleep(300);
  assert.notEqual(ann.last('trapok')?.uid, 'none', 'a mine set out of nothing');
  ok('and not when they do not');

  await bob.until('somebody near it was not told of it', () => (bob.last('traps')?.near.length ?? 0) === 1);
  await sleep(1300);
  assert.equal(far.last('traps')?.near.length ?? 0, 0, `somebody ${400} m off was told of it`);
  ok(`it is told to whoever is within ${TRAP_KEEP.sight} m, and nobody further off`);

  bob.at(X + 1.2, Y, Z);
  await sleep(300);
  assert.ok(!bob.got.some((m) => m.t === 'dmg'), 'it went off before it was armed');
  ok('it does nothing until it has armed');
  bob.at(X + 20, Y, Z);
  await sleep((TRAPS.bear_trap.arm + 0.4) * 1000);
  // (at a sprint, from one side of it to the other in one step)
  bob.at(X - 0.2, Y, Z);
  await bob.until('stepping over it set nothing off', () => bob.got.some((m) => m.t === 'dmg'));
  const hit = bob.last('dmg')!;
  assert.equal(hit.w, 'trap');
  assert.equal(hit.zone, 'legs');
  assert.equal(hit.amount, TRAPS.bear_trap.damage);
  assert.equal(hit.from, 0, 'a trap is nobody\'s doing');
  await bob.until('the snap was not told to whoever is near', () => bob.last('trapgo')?.how === 'snap');
  ok('a foot crossing it at a sprint sets it off: the legs, and nobody\'s doing');

  const [mine] = ann.carry('land_mine');
  await sleep(200);
  ann.send({ t: 'trap', k: 'land_mine', uid: mine.uid, o: [X + 1, Y, Z + 2.5], yaw: 0 });
  await ann.until('the mine was not set', () => ann.last('trapok')?.uid === mine.uid);
  await sleep(1300);
  await ann.until('a mine in sight was not told', () => (ann.last('traps')?.near.length ?? 0) === 1);
  const i = ann.last('traps')!.near[0][0];
  ann.send({ t: 'untrap', i });
  await ann.until('it did not come back to their pockets', () => ann.last('trapback')?.k === 'land_mine');
  ok('anybody may take one up, and it goes back in their pockets');

  ann.carry('land_mine');
  const [again] = ann.carry('land_mine');
  await sleep(200);
  ann.send({ t: 'trap', k: 'land_mine', uid: again.uid, o: [X + 1, Y, Z + 2.5], yaw: 0 });
  await ann.until('the second mine was not set', () => ann.last('trapok')?.uid === again.uid);
  ann.at(X + 30, Y, Z);
  bob.at(X + 3, Y, Z + 2.5);
  await sleep((TRAPS.land_mine.arm + 0.4) * 1000);
  bob.got.length = 0;
  bob.at(X + 1, Y, Z + 2.5);
  await bob.until('a mine stepped on did nothing', () => bob.last('trapgo')?.how === 'boom');
  await bob.until('the mine hurt nobody on it', () => bob.got.some((m) => m.t === 'dmg' && m.w === 'land_mine'));
  assert.equal(bob.got.find((m) => m.t === 'dmg')!.from, 0, 'a mine is nobody\'s doing');
  ok('a mine goes off under whoever steps on it, in nobody\'s name');
  console.log(`${n} checks passed`);
} catch (e) {
  failed = e;
}
server.kill();
await sleep(400);
try { rmSync(dir, { recursive: true, force: true }); } catch { /* still being let go of */ }
if (failed) {
  console.error(logged.slice(-1500));
  throw failed;
}
process.exit(0);
