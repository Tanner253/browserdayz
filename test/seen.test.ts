// Played today (server/seen.ts): the door's "N played today" counts each player once, and only once their game has
// moved them in the world: a connection that never plays is not counted. The real server on a port of its own.
//   npx tsx test/seen.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8218;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

async function join(name: string, key: string) {
  const got: S2C[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  ws.on('message', (d, bin) => !bin && got.push(JSON.parse(String(d)) as S2C));
  await new Promise<void>((done, fail) => {
    ws.once('open', () => done());
    ws.once('error', fail);
  });
  ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key, name }));
  for (let k = 0; k < 160 && !got.some((m) => m.t === 'welcome'); k++) await sleep(50);
  assert.ok(got.some((m) => m.t === 'welcome'), `${name} was not let in`);
  return { ws, move: (x: number) => ws.send(JSON.stringify({ t: 's', p: [x, ground(x, 0), 0, 0, 0, 0], w: null, m: [] })) };
}
const today = async () => ((await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json()) as { today: number }).today;

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-seen-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', FRESH_S: '0.2' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let checks = 0, failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  assert.equal(await today(), 0, 'somebody counted before anybody came');

  const quiet = await join('Quiet', 'seen-test-key-quiet-000000000000000001');
  await sleep(400);
  assert.equal(await today(), 0, 'a connection that never moved was counted');
  checks++;
  console.log('  ok  let in but never moving: not counted');

  const ann = await join('Ann', 'seen-test-key-ann-00000000000000000002');
  ann.move(30);
  ann.move(31);
  await sleep(300);
  assert.equal(await today(), 1, 'a player who moved was not counted once');
  checks++;
  console.log('  ok  a player who moves is counted, once');

  ann.ws.close();
  await sleep(300);
  const back = await join('Ann', 'seen-test-key-ann-00000000000000000002');
  back.move(32);
  const bob = await join('Bob', 'seen-test-key-bob-00000000000000000003');
  bob.move(40);
  await sleep(300);
  assert.equal(await today(), 2, 'one player back again was counted twice, or a second was not counted');
  checks++;
  console.log('  ok  back again is still one; a second player makes two');
  quiet.ws.close();
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(500);
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
