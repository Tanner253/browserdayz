// An admin's powers are theirs again when they come back (server/admin.ts, POWERS_KEPT): the owner, 2026-10-14,
// "admin state should be stored across server restart. currently when im flying around then leave then come back i
// fall and die as admin". On a server where everybody is an admin (LOCAL_ADMIN=1): noclip and god put on, gone,
// back; and somebody who never had them has none. The real server on a port of its own.
//   npx tsx test/powers-kept.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';

const PORT = 8219;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  await sleep(300);
  const powers = () => [...got].reverse().find((m) => m.t === 'powers') as Extract<S2C, { t: 'powers' }> | undefined;
  const order = async (text: string) => {
    ws.send(JSON.stringify({ t: 'chat', ch: 'global', text }));
    await sleep(400);
  };
  return { ws, powers, order };
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-powers-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LOCAL_ADMIN: '1', FRESH_S: '0.2' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let checks = 0, failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);

  const KEY = 'powers-test-key-ann-0000000000000000001';
  const ann = await join('Ann', KEY);
  await ann.order('/noclip on');
  await ann.order('/god');
  assert.ok(ann.powers()?.clip && ann.powers()?.god, `noclip and god were not put on: ${JSON.stringify(ann.powers())}`);
  ann.ws.close();
  await sleep(800);

  const back = await join('Ann', KEY);
  const p = back.powers();
  assert.ok(p?.clip, `back, she is not flying: ${JSON.stringify(p)}`);
  assert.ok(p?.god, `back, she is not in god mode: ${JSON.stringify(p)}`);
  checks++;
  console.log('  ok  an admin who left flying, in god mode, is flying and in god mode when she is back');

  await back.order('/noclip off');
  back.ws.close();
  await sleep(800);
  const again = await join('Ann', KEY);
  assert.ok(!again.powers()?.clip && again.powers()?.god, `what she put off came back, or what she left on did not: ${JSON.stringify(again.powers())}`);
  checks++;
  console.log('  ok  what she put off stays off, and what she left on stays on');
  again.ws.close();

  const bob = await join('Bob', 'powers-test-key-bob-0000000000000000002');
  assert.ok(!bob.powers()?.clip && !bob.powers()?.god, `somebody who never had them has them: ${JSON.stringify(bob.powers())}`);
  checks++;
  console.log('  ok  another admin who never put them on has none of them');
  bob.ws.close();
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
  console.error(logged.slice(-1500));
  throw failed;
}
console.log(`\n${checks} checks passed`);
process.exit(0);
