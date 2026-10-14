// npx tsx scripts/split/join-check.ts: DOES THE SERVER AS IT IS NOW BOOT AND LET A PLAYER IN? (the split's second proof, 2026-10-14)
// It starts server/index.ts from this tree on a port of its own (8191), with `.env.local-server` (SITE_URL is an
// address where nothing answers, so nothing reaches the live site or its payouts) and a data folder of its own, so
// the owner's local server on 8080 is not touched. Then: /healthz answers with this PROTOCOL; a player says hello and
// is welcomed; walks a few seconds; a second player joins and each sees the other; both leave. Anything the server
// writes that looks like a crash fails it.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../../src/net/protocol';

const PORT = 8191, SITE = 'http://127.0.0.1:9';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// (refuse to start at all unless the env file still points away from the live site: CLAUDE.md, "never empty or delete SITE_URL")
assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting a server');

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-join-'));
const server = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  // (what is set here wins over the env file: node's --env-file never overrides a variable already set)
  env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  shut = false;
  constructor(public name: string, public key = `join-check-key-${name}-`.padEnd(40, '0')) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 300 && !this.shut && !this.welcome; k++) await sleep(50);
    assert.ok(this.welcome, `${this.name} was not let in; got: ${JSON.stringify(this.got).slice(0, 300)}`);
  }
  get welcome() { return this.got.find((m) => m.t === 'welcome') as (S2C & { t: 'welcome'; you: number }) | undefined; }
  say(x: number, y: number, z: number, t: number) {
    if (!this.shut) this.ws.send(JSON.stringify({ t: 's', p: [x, y, z, Math.sin(t), 0.1 * Math.cos(t), 1], w: null, m: [] }));
  }
}

let failed: unknown = null;
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
  const health = (await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json()) as { ok: boolean; protocol: number; loot: number };
  assert.equal(health.ok, true);
  assert.equal(health.protocol, PROTOCOL, 'healthz says another protocol');
  console.log(`  ok  booted; healthz protocol ${health.protocol}, ${health.loot} loot`);
  const a = new Player('JoinA');
  await a.join();
  console.log(`  ok  ${a.name} welcomed as ${a.welcome!.you}`);
  // (where the welcome set them down, walked about a little)
  const sp = (a.welcome as unknown as { spawn: { x: number; y?: number; z: number } }).spawn;
  const [x0, y0, z0] = [sp.x, sp.y ?? 30, sp.z];
  for (let t = 0; t < 3; t += 0.1) { a.say(x0 + t, y0, z0, t); await sleep(100); }
  const b = new Player('JoinB');
  await b.join();
  for (let t = 0; t < 2; t += 0.1) { a.say(x0 + 3, y0, z0 + t, t); b.say(x0 + 4, y0, z0 + t, t); await sleep(100); }
  const seen = JSON.stringify(b.got).includes('JoinA') && JSON.stringify(a.got).includes('JoinB');
  assert.ok(seen, 'the two players were not told of each other');
  console.log('  ok  a second player joined and each was told of the other');
  assert.ok(!a.shut && !b.shut, 'a player was put out');
  a.ws.close(); b.ws.close();
  await sleep(500);
  const bad = logged.split('\n').filter((l) => /TypeError|ReferenceError|SyntaxError|RangeError|Unhandled|uncaught|\bat .*\.ts:\d+/i.test(l));
  assert.equal(bad.length, 0, `the server wrote what looks like a crash:\n${bad.slice(0, 10).join('\n')}`);
  console.log('  ok  nothing in the server\'s log looks like a crash');
} catch (e) {
  failed = e;
} finally {
  // (the whole tree: on Windows tsx's own child, the server itself, is not ended with it)
  if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error('JOIN CHECK FAILED:', failed instanceof Error ? failed.message : failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log('JOIN CHECK PASSED');
process.exit(0);
