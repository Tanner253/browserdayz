// The dead are kept through a restart (server/keep.ts `bodies`, server/index.ts saveWorld; 2026-10-17: a player
// walking up to the body of somebody they had killed saw it go, the server having been started again). A player dies
// with something on them; the server stops and starts again on the same save; a player coming in is told of the body
// where it lay, and opened, it holds what was on it. About twenty seconds.
//   npx tsx test/bodies-kept.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { makeItem } from '../src/sim/items';

const PORT = 8243;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (name: string) => {
  checks++;
  console.log('  ok  ' + name);
};

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string, public key = `bodies-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async join(): Promise<boolean> {
    this.got = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    return this.got.some((m) => m.t === 'welcome');
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-bodies-'));
const start = () => {
  const s = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    // (stopped by a word on its input, as SIGTERM is not caught on every system)
    env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'off', LOCAL_ADMIN: '1', STOP_BY_WORD: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const out = { text: '' };
  s.stdout!.on('data', (d) => (out.text += d));
  s.stderr!.on('data', (d) => (out.text += d));
  return { s, out };
};
const up = async (o: { text: string }) => {
  for (let k = 0; k < 1800 && !o.text.includes('listening'); k++) await sleep(100);
  assert.ok(o.text.includes('listening'), `the server did not start:\n${o.text.slice(-600)}`);
};
const stop = async (s: ChildProcess, o: { text: string }) => {
  s.stdin!.write('stop');
  for (let k = 0; k < 200 && s.exitCode === null; k++) await sleep(100);
  if (s.exitCode === null) s.kill('SIGKILL');
  assert.ok(o.text.includes('saving world'), 'the server did not save as it stopped');
};

let failed: unknown = null;
let run = start();
try {
  await up(run.out);
  const ann = new Player('Ann');
  assert.ok(await ann.join());
  // (with a tin on her, said as her game says what she carries; then dead by her own hand, as an admin may)
  const tin = makeItem('beans');
  ann.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'pockets', items: [{ ...tin, x: 0, y: 0, rot: false }] }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false, blood: 5000, bleed: 0 } });
  await sleep(300);
  // (an admin's body is left bare unless they choose otherwise: everybody is an admin on this server)
  ann.send({ t: 'chat', ch: 'global', text: '/voidinv off' });
  await sleep(600);
  ann.send({ t: 'chat', ch: 'global', text: '/die' });
  let corpse: { uid: string; x: number; z: number } | undefined;
  for (let k = 0; k < 60 && !corpse; k++) {
    const d = ann.got.find((m): m is Extract<S2C, { t: 'death' }> => m.t === 'death' && !!(m as { corpse?: unknown }).corpse) as { corpse?: { uid: string; x: number; z: number } } | undefined;
    corpse = d?.corpse;
    await sleep(100);
  }
  assert.ok(corpse, 'no body when she died');
  ok('a player died and left a body');

  await stop(run.s, run.out);
  run = start();
  await up(run.out);
  const bob = new Player('Bob');
  assert.ok(await bob.join());
  const w = bob.got.find((m): m is Extract<S2C, { t: 'welcome' }> => m.t === 'welcome')!;
  const kept = w.corpses.find((c) => c.uid === corpse!.uid);
  assert.ok(kept, `the body was not kept through the restart: ${JSON.stringify(w.corpses)}`);
  assert.ok(Math.hypot(kept.x - corpse.x, kept.z - corpse.z) < 0.5, 'the body was kept somewhere else');
  ok('after a restart a player coming in is told of the body where it lay');

  // opened, it holds what she had (standing by it)
  bob.send({ t: 's', p: [kept.x + 0.5, kept.y, kept.z, 0, 0, 0], w: null, m: [] });
  await sleep(200);
  bob.send({ t: 'copen', cid: kept.uid });
  let items: { id: string }[] | null = null;
  for (let k = 0; k < 40 && !items; k++) {
    const m = bob.got.find((q): q is Extract<S2C, { t: 'cdata' }> => q.t === 'cdata' && q.cid === kept.uid);
    items = m?.items ?? null;
    await sleep(50);
  }
  assert.ok(items?.some((it) => it.id === 'beans'), `what was on the body is not on it: ${JSON.stringify(items)}`);
  ok('and what was on it is on it still');
} catch (e) {
  failed = e;
} finally {
  run.s.kill('SIGKILL');
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) {
  console.error(run.out.text.slice(-1500));
  throw failed;
}
console.log(`${checks} checks passed`);
process.exit(0);
