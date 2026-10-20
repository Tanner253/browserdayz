// npx tsx test/party.test.ts: PARTIES (server/party.ts) on this tree's server, booted on a port of its own (8159) as
// scripts/split/join-check.ts boots it (.env.local-server: nothing reaches the live site). Asked face to face and by name,
// a yes, a leave, and a member who drops and comes back is still in it.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';

const PORT = 8159, SITE = 'http://127.0.0.1:9';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting a server');
const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-party-'));
const server = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));

type Party = { id: number | null; name: string }[];
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  shut = false;
  constructor(public name: string, public key = `party-test-key-${name}-`.padEnd(40, '0')) {}
  async join() {
    this.got = [];
    this.shut = false;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 300 && !this.shut && !this.id; k++) await sleep(50);
    assert.ok(this.id, `${this.name} was not let in`);
  }
  get id() { return (this.got.find((m) => m.t === 'welcome') as { you: number } | undefined)?.you; }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  /** the last word of who is in their party */
  get party(): Party | undefined { return (this.got.filter((m) => m.t === 'party').at(-1) as { members: Party } | undefined)?.members; }
  asked(by: Player) { return this.got.some((m) => m.t === 'partyAsk' && m.from === by.id); }
}
const names = (p?: Party) => (p ?? []).map((m) => `${m.name}${m.id === null ? '?' : ''}`).sort().join(',');

let failed: unknown = null;
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
  const [a, b, c] = [new Player('Ann'), new Player('Bob'), new Player('Cat')];
  for (const p of [a, b, c]) await p.join();
  // asked face to face, and a yes
  a.send({ t: 'party', act: 'invite', id: b.id });
  await sleep(400);
  assert.ok(b.asked(a), 'Bob was not asked');
  assert.equal(a.party, undefined, 'a party before anybody said yes');
  b.send({ t: 'party', act: 'accept' });
  await sleep(400);
  assert.equal(names(a.party), 'Ann,Bob');
  assert.equal(names(b.party), 'Ann,Bob');
  assert.deepEqual(a.party!.map((m) => m.id).sort(), [a.id, b.id].sort(), 'the members are not known by their ids');
  assert.equal(c.party, undefined, 'one outside the party was told of it');
  console.log('  ok  asked face to face, and a yes: both told who is in it, by id; nobody else told');
  // asked by name, and the yes is the same ask made back
  c.send({ t: 'chat', text: '/invite ann' });
  await sleep(400);
  assert.ok(a.asked(c), 'Ann was not asked by name');
  a.send({ t: 'party', act: 'invite', id: c.id });
  await sleep(400);
  assert.equal(names(a.party), 'Ann,Cat', 'asked back, Ann did not go to Cat\'s party');
  assert.deepEqual(b.party, [], 'Bob, left alone, was not told he is in no party');
  console.log('  ok  asked by name; asking back is a yes; one left alone is in no party');
  // away and back: still in it
  c.ws.close();
  await sleep(500);
  assert.equal(names(a.party), 'Ann,Cat?', 'Cat away was not said to be away');
  await c.join();
  await sleep(400);
  assert.equal(names(c.party), 'Ann,Cat', 'Cat back was not in the party');
  assert.equal(a.party!.find((m) => m.name === 'Cat')?.id, c.id, 'Cat back under a new id was not known');
  console.log('  ok  a member away is listed as away, and is in it again on coming back');
  // leaving
  c.send({ t: 'chat', text: '/leave' });
  await sleep(400);
  assert.deepEqual(a.party, [], 'Ann alone was still in a party');
  assert.deepEqual(c.party, [], 'Cat was still in one');
  console.log('  ok  /leave, and the one left alone is in none');
  for (const p of [a, b, c]) p.ws.close();
  await sleep(500);
  const bad = logged.split('\n').filter((l) => /TypeError|ReferenceError|SyntaxError|RangeError|Unhandled|uncaught|\bat .*\.ts:\d+/i.test(l));
  assert.equal(bad.length, 0, `the server wrote what looks like a crash:\n${bad.slice(0, 10).join('\n')}`);
} catch (e) {
  failed = e;
} finally {
  if (process.platform === 'win32' && server.pid) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGKILL');
  await sleep(300);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
}
if (failed) throw failed;
console.log('\nparties pass');
