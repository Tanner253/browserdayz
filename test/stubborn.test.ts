// A body the server's count says is dead is dead, whatever its own game is doing (server/checks.ts `dealt`,
// server/gate.ts `standing`; the owner, 2026-10-28: "there should be no state where a player body is not killable or
// does not take damage when shot regaurdless of the client state"). On a server of its own, in the checks' watch mode:
// a game that keeps answering but never takes its hits is killed by the server; one whose medicine went from its
// pockets between the hits is given that health back first. Never the live server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';
import { readWalls, roundClear } from '../server/walls';

const PORT = 8413;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
await readWalls(gunzipSync(readFileSync('server/solids.bin.gz')), null);
// (two places in the open three metres apart, every line between them clear: test/walls-hit.test.ts's open ground;
// a place picked at random could be in the trader camp, where nobody is hurt)
const [sx, sz] = [57.2, 28.5];
assert.ok(roundClear([sx, ground(sx, sz) + 1.6, sz], [sx + 3, ground(sx + 3, sz) + 1.2, sz]), 'the ground the test stands on is not open');

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public name: string, public key = `stubborn-test-${name}-${String(++n).padStart(20, '0')}`) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((r) => this.ws.once('open', () => r()));
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    this.id = (this.got.find((m) => m.t === 'welcome') as { you: number }).you;
  }
  send(m: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  /** standing at x, z, facing +x (towards whoever is shot), with `w` in the hands */
  at(x: number, z: number, w: string | null = null) {
    this.send({ t: 's', p: [x, ground(x, z), z, -Math.PI / 2, 0, 0], w, m: [] });
  }
  pockets(stims: number, health: number) {
    const slots = stims ? { vest: null, belt: { uid: `stims-${this.name}`, id: 'stim', qty: stims } } : {};
    this.send({ t: 'me', inv: { slots, active: null, containers: [] }, vitals: { health, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
  sawDie(who: Player) {
    return this.got.some((m) => m.t === 'death' && (m as { k: { id: number } }).k.id === who.id);
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-stubborn-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LOCAL_ADMIN: '', SIGHT: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let failed: unknown = null;
try {
  for (let k = 0; k < 900 && !(logged.includes('listening') && logged.includes('[walls]')); k++) await sleep(100);
  assert.match(logged, /listening/, `the server did not start:\n${logged.slice(-600)}`);

  // ---- Tom's game answers all the while and never takes a hit, nor says he died: the server kills him
  const gil = new Player('Gil'), tom = new Player('Tom');
  await gil.join();
  await tom.join();
  tom.pockets(0, 100);
  let tomOn = true;
  const keep = setInterval(() => {
    gil.at(sx, sz, 'mosin');
    if (tomOn) tom.at(sx + 3, sz);
  }, 250);
  await sleep(2500);
  for (let k = 0; k < 4 && !gil.sawDie(tom); k++) {
    gil.send({ t: 'hit', to: tom.id, w: 'mosin', zone: 'torso' });
    await sleep(2400);
  }
  assert.ok(gil.sawDie(tom), `a game that took no hits was not killed by the server:\n${logged.slice(-700)}`);
  console.log(`  ok  a game that answers but takes no hits is killed by the server (${gil.got.filter((m) => m.t === 'hitok').length} rounds)`);
  tomOn = false;

  // ---- Una takes a round (her game says so), uses two stims, then another round: the stims count, she stays up
  const una = new Player('Una');
  await una.join();
  una.pockets(2, 100);
  const unaOn = setInterval(() => una.at(sx + 3, sz + 1), 250);
  await sleep(2000);
  gil.send({ t: 'hit', to: una.id, w: 'mosin', zone: 'torso' });
  await sleep(1500);
  una.pockets(2, 16);
  await sleep(600);
  una.pockets(0, 86);
  await sleep(1500);
  gil.send({ t: 'hit', to: una.id, w: 'mosin', zone: 'arms' });
  await sleep(2500);
  assert.ok(!gil.sawDie(una), `a game that healed between the rounds was killed by the server:\n${logged.slice(-700)}`);
  console.log('  ok  medicine gone from the pockets between the rounds is counted: she stays up');
  clearInterval(unaOn);
  clearInterval(keep);
} catch (e) {
  failed = e;
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
if (failed) throw failed;
console.log('stubborn ok');
process.exit(0);
