// The way down's stops on the real server (server/sites.ts): the reader takes the right card from somebody standing at it and
// nobody else; the strong room opens, its crate is set down, the infected come; when the time is up the locker holds the next
// card; and then the place shuts again, as it was. The real server is started on a port of its own.   npx tsx test/sites.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { makeItem } from '../src/sim/items';
import { SITES, sitePoint } from '../src/sim/sites';

const PORT = 8422;
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
    this.send({ t: 'hello', v: PROTOCOL, key: `sites-${this.name}`.padEnd(40, '0'), name: this.name });
    for (let k = 0; k < 300 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    assert.ok(this.got.some((m) => m.t === 'welcome'), `${this.name} was not let in`);
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  at(x: number, y: number, z: number) { this.send({ t: 's', p: [x, y, z, 0, 0, 1], w: null, m: [] }); }
  carry(...ids: string[]) {
    const items = ids.map((id, k) => ({ ...makeItem(id, 1), x: k * 3, y: 0, rot: false }));
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'pockets', items }] }, vitals: VITALS });
  }
  all<T extends S2C['t']>(t: T) { return this.got.filter((m) => m.t === t) as Extract<S2C, { t: T }>[]; }
  last<T extends S2C['t']>(t: T) { return this.all(t).pop(); }
  async until(what: string, f: () => boolean, ms = 4000) {
    for (let k = 0; k < ms / 40 && !f(); k++) await sleep(40);
    assert.ok(f(), what);
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-sites-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, BOTCHECK: 'off', CHECKS: 'off', INFECTED: 'off', FRESH_S: '0.001', SITE_HOLD_S: '3', SITE_AGAIN_S: '3' },
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
  const s = SITES.stolovaya, [x, z] = sitePoint(s, s.reader), Y = 40;
  const ann = new Player('Ann'), bob = new Player('Bob');
  await ann.join();
  await bob.join();
  await ann.until('a game coming in is told how the site stands', () => ann.last('site')?.phase === 'idle');
  ok('a game coming in is told how a site stands');

  // (no card)
  ann.at(x + 1, Y, z);
  ann.carry('bandage');
  await sleep(250);
  ann.send({ t: 'site', s: 'stolovaya' });
  await sleep(300);
  assert.equal(ann.all('siteok').length, 0);
  // (the wrong one)
  ann.carry('keycard');
  await sleep(250);
  ann.send({ t: 'site', s: 'stolovaya' });
  await sleep(300);
  assert.equal(ann.all('siteok').length, 0);
  ok('the reader takes no other card, and nothing from an empty hand');

  // (the right one, from too far)
  bob.at(x + 40, Y, z);
  bob.carry('card_blue');
  await sleep(250);
  bob.send({ t: 'site', s: 'stolovaya' });
  await sleep(300);
  assert.equal(bob.all('siteok').length, 0);
  ok('nor from anybody not standing at it');

  ann.carry('card_blue');
  await sleep(250);
  ann.send({ t: 'site', s: 'stolovaya' });
  await ann.until('the card went in', () => ann.all('siteok').length === 1);
  assert.equal(ann.last('siteok')!.card, 'card_blue');
  await bob.until('everybody hears the alarm', () => bob.last('site')?.phase === 'alarm');
  assert.ok(bob.last('site')!.left >= 1 && bob.last('site')!.left <= 3, 'it tells how long is left');
  await bob.until('the strong room opened', () => bob.all('door').some((m) => m.open));
  const door = bob.all('door').find((m) => m.open)!.i;
  const crate = bob.all('drop+').find((m) => m.d.site?.includes('strong room'))?.d;
  assert.ok(crate, 'the strong room has a crate');
  const [cx, cz] = sitePoint(s, s.crate);
  assert.ok(Math.hypot(crate.x - cx, crate.z - cz) < 0.1);
  ok('the card goes in: the room opens, a crate is set in it, and everybody is told');

  await bob.until('the infected came', () => bob.all('i+').length >= s.wave.n);
  ok(`${s.wave.n} infected come`);

  ann.carry('card_blue');
  await sleep(250);
  ann.send({ t: 'site', s: 'stolovaya' });
  await sleep(300);
  assert.equal(ann.all('siteok').length, 1);
  ok('a second card does nothing while it is going');

  await bob.until('the alarm ended', () => bob.last('site')?.phase === 'spent', 5000);
  await bob.until('a locker stood', () => bob.all('drop+').some((m) => m.d.site?.includes('locker')));
  const locker = bob.all('drop+').find((m) => m.d.site?.includes('locker'))!.d;
  ann.at(locker.x, locker.y, locker.z);
  await sleep(250);
  ann.send({ t: 'copen', cid: locker.uid });
  await ann.until('the locker opened', () => ann.all('cdata').some((m) => m.cid === locker.uid));
  const inside = ann.all('cdata').find((m) => m.cid === locker.uid)!.items.map((i) => i.id);
  assert.ok(inside.includes(s.gives), `the locker holds ${s.gives}: ${inside}`);
  ok(`at the end of it the locker holds ${s.gives}`);

  await bob.until('the place came back', () => bob.last('site')?.phase === 'idle', 5000);
  await bob.until('the room shut', () => bob.all('door').some((m) => m.i === door && !m.open));
  await bob.until('the crates went', () => bob.all('drop-').length >= 2);
  const doors = bob.all('door').length;
  bob.send({ t: 'door', i: door, open: true, swing: 1 });
  await sleep(300);
  assert.equal(bob.all('door').length, doors, 'the shut room stays shut to a hand on its door');
  ok('and then it shuts again as it was, locked to a hand on its door');
} catch (e) {
  failed = e;
}
server.kill();
await sleep(200);
try { rmSync(dir, { recursive: true, force: true }); } catch { /* (the server may still hold it) */ }
if (failed) {
  console.log(logged.slice(-1200));
  throw failed;
}
console.log(`sites: ${n} passed`);
process.exit(0);
