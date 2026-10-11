// Admins, and who they have banned (server/index.ts `command`, api/admin.ts). The real game server is started on
// a port of its own, twice, with a stand-in for the site on this machine: the real api/admin code over a store
// that is a variable. Nothing here touches the real site or its store. About half a minute.
//   npx tsx test/admin.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { admin, type AdminState } from '../api/admin';
import type { Store } from '../api/_lib/store';
import { PROTOCOL, type S2C } from '../src/net/protocol';

const PORT = 8143, SITE = 8144;
// (a password made up here, for this test's stand-in site and nothing else)
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- the site, standing here: one file, in a variable
const files = new Map<string, { text: string; mark: number }>();
let writes = 0;
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
    writes++;
    files.set(p, { text: JSON.stringify(data), mark: (f?.mark ?? 0) + 1 });
    return String((f?.mark ?? 0) + 1);
  },
  async list() {
    return [...files.keys()];
  },
};
const site = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${SITE}`);
  const out = url.pathname === '/api/admin' ? await admin(new Request(url, { method: 'POST' }), store, `http://127.0.0.1:${PORT}`, { ADMIN_PASSWORD: PASSWORD }) : new Response('not here', { status: 404 });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(await out.text());
});
await new Promise<void>((done) => site.listen(SITE, '127.0.0.1', done));
const kept = () => JSON.parse(files.get('zona/admin.json')?.text ?? '{"roles":{},"bans":[]}') as AdminState;

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  /** @param ip where they are said to play from (an address out of the range kept for examples) */
  constructor(public name: string, public ip = `203.0.113.${++n}`, public key = `admin-test-key-${name}-${String(n).padStart(20, '0')}`) {}
  async join(): Promise<boolean> {
    this.got = [];
    this.shut = false;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { 'x-forwarded-for': this.ip } });
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.shut && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    if (!w) return false;
    this.id = w.you;
    return true;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  /** an order, typed where talk is typed; @returns what the server said back */
  async order(text: string): Promise<string> {
    const from = this.got.length;
    this.send({ t: 'chat', ch: 'global', text });
    await sleep(900);
    return this.got.slice(from).filter((m) => m.t === 'sys').map((m) => (m as { text: string }).text).join('\n');
  }
  get role() {
    return (this.got.filter((m) => m.t === 'role').pop() as { role: string | null } | undefined)?.role;
  }
  get kicked(): string | undefined {
    return (this.got.find((m) => m.t === 'kick') as { reason: string } | undefined)?.reason;
  }
  heard(text: string) {
    return this.got.some((m) => m.t === 'chat' && (m as { text: string }).text.includes(text));
  }
}

async function withServer(play: (log: () => string) => Promise<void>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-admin-'));
  const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logged = '';
  server.stdout!.on('data', (d) => (logged += d));
  server.stderr!.on('data', (d) => (logged += d));
  let failed: unknown = null;
  try {
    for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
    assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
    for (let k = 0; k < 100 && !logged.includes('lists read from the site'); k++) await sleep(100);
    assert.ok(logged.includes('lists read from the site'), `the lists were not read:\n${logged.slice(-600)}`);
    await play(() => logged);
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
}

let checks = 0;
const ann = new Player('Ann'), bob = new Player('Bob'), cat = new Player('Cat'), dan = new Player('Dan');

await withServer(async (log) => {
  for (const p of [ann, bob, cat, dan]) assert.ok(await p.join(), `${p.name} was not let in`);

  // ---- nobody has a role to begin with, and an order is not talk
  assert.match(await dan.order('/ban Ann'), /not a thing you can do/);
  assert.match(await dan.order('/admin hunter2'), /not a thing you can do/);
  assert.ok(!ann.heard('/ban') && !ann.heard('hunter2'), 'an order was said to everybody');
  assert.ok(!log().includes('hunter2'), 'what was typed after /admin was written down');
  checks++;
  console.log('  ok  with no role an order does nothing, is said to nobody and is not written down');

  // ---- the password: wrong, then right
  ann.send({ t: 'admin', pw: 'not-it' });
  await sleep(1200);
  assert.ok(ann.got.some((m) => m.t === 'sys' && /not the password/.test((m as { text: string }).text)), 'a wrong password was not refused');
  assert.equal(ann.role, undefined);
  ann.send({ t: 'admin', pw: PASSWORD });
  await sleep(1500);
  assert.equal(ann.role, 'admin', `the right password made nobody an admin:\n${log().slice(-400)}`);
  assert.ok(!log().includes(PASSWORD), 'the password was written down');
  assert.equal(Object.values(kept().roles).filter((r) => r.role === 'admin').length, 1, 'the site did not keep her role');
  assert.ok(!JSON.stringify(kept()).includes(ann.key), 'her key is in the file as it is');
  checks++;
  console.log('  ok  a wrong password is refused; the right one makes an admin, kept by the site, and is written down nowhere');

  // ---- she sees who is here, makes a mod, and the mod can kick but not ban
  assert.match(await ann.order('/players'), /Bob[\s\S]*Cat|Cat[\s\S]*Bob/);
  assert.match(await ann.order('/mod Cat'), /Cat is a mod/);
  await sleep(300);
  assert.equal(cat.role, 'mod');
  assert.match(await cat.order('/ban Dan'), /Only an admin/);
  assert.match(await cat.order('/kick Dan being a test'), /Dan is off the server/);
  await sleep(300);
  assert.match(dan.kicked ?? '', /put off the server: being a test/);
  assert.ok(await dan.join(), 'somebody kicked could not come back');
  checks++;
  console.log('  ok  a mod kicks and cannot ban; whoever is kicked can come back');

  // ---- a timeout keeps somebody off; a ban keeps them off and is kept by the site
  assert.match(await cat.order('/timeout Dan 5 cooling off'), /off the server for 5 minutes/);
  await sleep(300);
  assert.ok(!(await dan.join()), 'somebody timed out was let straight back in');
  assert.match(dan.kicked ?? '', /kept off this server/);
  assert.match(await ann.order('/ban Bob flying'), /Bob is banned/);
  await sleep(300);
  assert.match(bob.kicked ?? '', /banned/);
  assert.ok(!(await bob.join()), 'somebody banned was let back in');
  assert.match(bob.kicked ?? '', /You are banned/);
  assert.equal(kept().bans.length, 1);
  assert.equal(kept().bans[0].name, 'Bob');
  assert.equal(kept().bans[0].why, 'flying');
  assert.match(await ann.order('/bans'), /1\. Bob/);
  checks++;
  console.log('  ok  a timeout keeps somebody off for its minutes; a ban puts them off, keeps them off, and is written to the site');
});

// ---- the server restarts, and forgets nothing of it
await withServer(async () => {
  assert.ok(await ann.join(), 'the admin was not let in');
  await sleep(400);
  assert.equal(ann.role, 'admin', 'after a restart she is no admin');
  assert.ok(!(await bob.join()), 'after a restart the ban is forgotten');
  assert.ok(await dan.join(), 'a timeout outlived the restart (it is not meant to)');
  // somebody at Bob's address with another game is kept off too; and the admin, were she at that address, is not
  const alt = new Player('Robert', bob.ip);
  assert.ok(!(await alt.join()), 'a ban did not keep off another game at the same address');
  ann.ws.close();
  await sleep(300);
  ann.ip = bob.ip;
  assert.ok(await ann.join(), 'an admin was kept off by a ban of the address she plays from');
  // somebody else, with his name, another game and another address, is not Bob
  const bob2 = new Player('Bob');
  assert.ok(await bob2.join(), 'a ban kept off somebody else of the same name');
  // one player to an address: a second game from where Dan plays is turned away, and let in when he has gone
  const twin = new Player('Twin', dan.ip);
  assert.ok(!(await twin.join()), 'a second game from one address was let in');
  assert.match(twin.kicked ?? '', /one player to a connection/);
  // (he leaves; banned after he has gone, he is kept off all the same)
  bob2.ws.close();
  await sleep(400);
  assert.match(await ann.order('/recent'), /Bob/);
  assert.match(await ann.order('/ban Bob gone but not forgotten'), /Bob is banned/);
  assert.ok(!(await bob2.join()), 'somebody banned after leaving was let back in');
  const before = writes;
  assert.match(await ann.order('/unban 1'), /no longer banned/);
  assert.equal(writes, before + 1, 'an unban was not one write');
  assert.ok(await bob.join(), 'somebody unbanned was not let in');
  assert.match(await ann.order('/demote Cat'), /Nobody online is "Cat"/);
  checks++;
  console.log('  ok  after a restart the admin is an admin and the banned are banned; a ban is of a key, not a name; one who has left can be banned; an unban lets them in');
});

site.close();
console.log(`\n${checks} checks passed`);
