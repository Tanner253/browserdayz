// npx tsx test/bait.test.ts: a game that reads window.__game is banned (src/net/bait.ts, server/admin.ts baited).
// The owner, 2026-10-20, with a wallhack script passed round among players that went through window.__game: "confirm
// this vilnerability and then fix it with emergency restart server and ban anyone using this exploit".
// This tree's server on a port of its own (as scripts/split/join-check.ts starts it): a player says the trap was
// sprung and is put out banned, and kept out when they come back; another player is let in as ever.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';

const PORT = 8197, SITE = 'http://127.0.0.1:9';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting a server');

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-bait-'));
const server = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '0', LOCAL_ADMIN: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  shut = false;
  constructor(public name: string, public key = `bait-test-key-${name}-`.padEnd(40, '0')) {}
  async join() {
    this.got = [];
    this.shut = false;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name, fp: `fp-${this.name}`.padEnd(64, 'a') }));
    for (let k = 0; k < 200 && !this.shut && !this.welcome; k++) await sleep(50);
  }
  get welcome() { return this.got.find((m) => m.t === 'welcome'); }
  get kick() { return this.got.find((m) => m.t === 'kick') as { reason: string } | undefined; }
}

let failed: unknown = null;
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
  const a = new Player('Cheater'), b = new Player('Honest');
  await a.join();
  assert.ok(a.welcome, `Cheater was not let in at first: ${JSON.stringify(a.got).slice(0, 300)}`);
  a.ws.send(JSON.stringify({ t: 'bait', what: '__game' }));
  for (let k = 0; k < 100 && !a.shut; k++) await sleep(50);
  assert.ok(a.shut, 'the cheater was not put out');
  assert.match(a.kick?.reason ?? '', /banned/i, `told: ${a.kick?.reason}`);
  assert.match(logged, /\[cheat\] Cheater \(#\d+\) banned: cheat script \(read window\.__game\)/);
  console.log('  ok  reading window.__game: put out, banned, written down');
  await a.join();
  assert.ok(!a.welcome, 'the banned cheater was let back in');
  console.log('  ok  kept out on coming back');
  await b.join();
  assert.ok(b.welcome, `an honest player was not let in: ${JSON.stringify(b.got).slice(0, 300)}`);
  console.log('  ok  another player let in as ever');
} catch (e) {
  failed = e;
} finally {
  if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error('BAIT TEST FAILED:', failed instanceof Error ? failed.message : failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log('BAIT TEST PASSED');
process.exit(0);
