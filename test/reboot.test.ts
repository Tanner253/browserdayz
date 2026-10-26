// A head admin restarts the server from the panel (`/reboot`, server/admin.ts; the owner, 2026-10-26: "As admin I should
// be able to trigger a restart from the panel (head admins only)"). What has to hold:
//   - an admin made by another, and a mod, are refused; the head admin's game is told they are one (`top`);
//   - everybody is told, with the reason, and counted down;
//   - everything kept is written to the site before the server stops, and then it stops.
// The real game server on a port of its own, with a stand-in for the site on this machine: the real api/admin and
// api/keep code over a store that is a variable. Nothing here touches the real site or its store. About forty seconds.
//   npx tsx test/reboot.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { admin } from '../api/admin';
import { keep } from '../api/keep';
import type { Store } from '../api/_lib/store';
import { PROTOCOL, type S2C } from '../src/net/protocol';

const PORT = 8401, SITE = 8402;
// (a password made up here, for this test's stand-in site and nothing else)
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- the site, standing here: its files in a variable, and every write to what is kept counted, in order
const files = new Map<string, { text: string; mark: number }>();
const said: string[] = [];
const store: Store = {
  async read<T>(p: string) {
    const f = files.get(p);
    return f ? { data: JSON.parse(f.text) as T, mark: String(f.mark) } : null;
  },
  async glance<T>(p: string) {
    const f = files.get(p);
    return f ? (JSON.parse(f.text) as T) : null;
  },
  async swap(p, data, mark) {
    const f = files.get(p);
    if ((f ? String(f.mark) : null) !== mark) return false;
    if (!p.includes('admin')) said.push(`kept ${p}`);
    files.set(p, { text: JSON.stringify(data), mark: (f?.mark ?? 0) + 1 });
    return String((f?.mark ?? 0) + 1);
  },
  async list() {
    return [...files.keys()];
  },
};
const site = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${SITE}`);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(url, { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) });
  const env = { ADMIN_PASSWORD: PASSWORD };
  const out = url.pathname === '/api/admin' ? await admin(request, store, `http://127.0.0.1:${PORT}`, env) : url.pathname === '/api/keep' ? await keep(request, store, env) : new Response('not here', { status: 404 });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(await out.text());
});
await new Promise<void>((done) => site.listen(SITE, '127.0.0.1', done));

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  /** @param ip where they are said to play from (an address out of the range kept for examples) */
  constructor(public name: string, public ip = `203.0.113.${40 + ++n}`, public key = `reboot-test-key-${name}-${String(n).padStart(20, '0')}`) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { 'x-forwarded-for': this.ip } });
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => (this.ws.once('open', () => done()), this.ws.once('error', fail)));
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    assert.ok(this.got.some((m) => m.t === 'welcome'), `${this.name} was not let in`);
  }
  send(m: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  async order(text: string) {
    const from = this.got.length;
    this.send({ t: 'chat', ch: 'global', text });
    await sleep(900);
    return this.got.slice(from).filter((m) => m.t === 'sys').map((m) => (m as { text: string }).text).join('\n');
  }
  role() {
    return this.got.filter((m): m is Extract<S2C, { t: 'role' }> => m.t === 'role').pop();
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-reboot-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', NEVER_SPOKE_S: '600', KEEP: 'on', KEEP_EVERY_MIN: '60', KEEP_WAIT_S: '3' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '', exited: number | null = null;
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
server.on('exit', (code) => {
  exited = code ?? -1;
  said.push('stopped');
});
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  for (let k = 0; k < 200 && !/\[keep\]/.test(logged); k++) await sleep(100);
  const ann = new Player('Ann'), bob = new Player('Bob'), cat = new Player('Cat');
  for (const p of [ann, bob, cat]) await p.join();

  // ---- the head admin, an admin she makes, and a mod
  ann.send({ t: 'admin', pw: PASSWORD });
  await sleep(1500);
  assert.equal(ann.role()?.role, 'admin', `the password made nobody an admin:\n${logged.slice(-400)}`);
  assert.equal(ann.role()?.top, true, 'the head admin is not told she is one');
  assert.match(await ann.order('/admin Bob'), /Bob is an admin/);
  assert.match(await ann.order('/mod Cat'), /Cat is a mod/);
  await sleep(300);
  assert.equal(bob.role()?.role, 'admin');
  assert.equal(bob.role()?.top, undefined, 'an admin made by another is told he is a head admin');

  // ---- neither may restart it
  assert.match(await bob.order('/reboot 3 not mine to do'), /Only a head admin/);
  assert.match(await cat.order('/reboot 3'), /Only a head admin/);
  assert.ok(!cat.got.some((m) => m.t === 'restart'), 'a refused restart was said to everybody');
  assert.equal(exited, null, 'a refused restart stopped the server');
  console.log('  ok  an admin made by another and a mod are refused, and nothing is said');

  // ---- she may: everybody told with the reason and counted down; kept, then stopped
  said.length = 0;
  assert.match(await ann.order('/reboot 3 testing the restart'), /restarts in 3 s/);
  const told = cat.got.find((m): m is Extract<S2C, { t: 'restart' }> => m.t === 'restart');
  assert.ok(told, 'nobody was told');
  assert.equal(told.why, 'testing the restart');
  assert.equal(told.in, 3);
  for (let k = 0; k < 300 && exited === null; k++) await sleep(100);
  assert.equal(exited, 0, `it did not stop:\n${logged.slice(-600)}`);
  const kept = said.indexOf(said.find((s) => s.startsWith('kept')) ?? ''), stopped = said.indexOf('stopped');
  assert.ok(kept >= 0, `nothing was kept before it stopped: ${said.join(', ')}`);
  assert.ok(kept < stopped, `it stopped before it was kept: ${said.join(', ')}`);
  assert.ok(logged.indexOf('kept before the restart') < logged.indexOf('shutting down'), 'it began to stop before it was kept');
  assert.ok(cat.got.some((m) => m.t === 'restart' && m.in === 0 && m.why === 'testing the restart'), 'the last word did not give the reason');
  console.log(`  ok  the head admin's restart: told with the reason, counted down, kept (${said.filter((s) => s.startsWith('kept')).length} writes), then stopped`);
  console.log('reboot: ok');
} catch (e) {
  failed = e;
} finally {
  if (exited === null) server.kill();
  site.close();
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
process.exit(0);
