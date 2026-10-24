// The Elite's crown in chat (server/elite.ts): a player whose payout the site says was at the top rate has `elite` on
// what they say in chat, everybody else not; a later payout below the top rate takes it off. It goes by the key that
// cashed the tags in, never by a wallet. The real server on a port of its own, and a stand-in for the site that pays
// whatever it is told to (nothing here reaches the real site). About twenty seconds.
//   npx tsx test/elite.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { generateWorld, heightAt } from '../src/world/worldgen';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { TAG_HOLD } from '../src/sim/items';

const PORT = 8228, SITE = 8229;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- the site, paying every cash-in at once: at the top rate or not, as the test says
let top = true;
const asked: string[] = [];
const site = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${SITE}`);
  if (url.pathname === '/api/cashin') {
    asked.push(url.searchParams.get('id') ?? '');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, payout: { state: 'paid', lamports: top ? 25_000_000 : 10_000_000, signature: 'test' }, ...(top ? { top: true } : {}) }));
  } else res.writeHead(url.pathname === '/api/tick' ? 200 : 404, { 'content-type': 'application/json' }).end('{}');
});
await new Promise<void>((done) => site.listen(SITE, '127.0.0.1', done));

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-elite-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'off', TAG_FRESH_S: '1', TAG_MIN_LIFE_S: '1', CASH_HOLD_S: '1', TAG_CAUSE_S: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));

const HEIGHTS = generateWorld().heights;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public key: string, public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.send({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name });
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    assert.ok(this.got.some((m) => m.t === 'welcome'), `${this.name} was not let in`);
    this.id = (this.got.find((m) => m.t === 'welcome') as { you: number }).you;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  /** standing at a place, as a game says where it stands (inside the Zona: only time there counts toward a tag of their own, and nobody who dies outside it leaves one, since 2026-10-19) */
  async stand(x: number, z: number, seconds: number) {
    for (let k = 0; k < seconds * 10; k++) {
      this.send({ t: 's', p: [x, heightAt(HEIGHTS, x, z), z, 0, 0, 0], w: null, m: [] });
      await sleep(100);
    }
  }
  /** a tag taken off a body as a game takes it: the body opened, and set again without it (the server keeps who holds each tag that can pay, server/custody.ts: a game's word that it carries one is not enough) */
  async takeOff(cid: string, uid: string) {
    const at = this.got.length;
    this.send({ t: 'copen', cid });
    for (let k = 0; k < 60 && !this.got.slice(at).some((m) => m.t === 'cdata' && m.cid === cid); k++) await sleep(50);
    const d = this.got.slice(at).find((m) => m.t === 'cdata' && m.cid === cid) as Extract<S2C, { t: 'cdata' }> | undefined;
    assert.ok(d?.items.some((it) => it.uid === uid), `${this.name} found no tag ${uid} on the body`);
    this.send({ t: 'cset', cid, items: d!.items.filter((it) => it.uid !== uid) });
    this.send({ t: 'cclose', cid });
    await sleep(150);
  }
  /** the body of the player numbered `id`, as this player was told of their death */
  bodyOf(id: number): string {
    const d = this.got.find((m) => m.t === 'death' && m.k.id === id) as Extract<S2C, { t: 'death' }> | undefined;
    assert.ok(d?.corpse, `${this.name} was told of no body of #${id}`);
    return d!.corpse!.uid;
  }
  carry(tags: object[]) {
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'tags', items: tags.map((t, i) => ({ ...t, x: i, y: 0, rot: false })) }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
  /** what they last heard said in chat by `who`, after saying something themselves */
  async says(who: Player, text: string) {
    who.send({ t: 'chat', ch: 'global', text });
    for (let k = 0; k < 40; k++) {
      const m = this.got.filter((x): x is Extract<S2C, { t: 'chat' }> => x.t === 'chat' && x.text === text).pop();
      if (m) return m;
      await sleep(50);
    }
    throw new Error(`${this.name} never heard "${text}"`);
  }
}

let checks = 0;
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const ann = new Player('elite-test-key-ann-00000000000000001', 'Ann'), bee = new Player('elite-test-key-bee-00000000000000002', 'Bee'), cat = new Player('elite-test-key-cat-00000000000000003', 'Cat');
  for (const p of [ann, bee, cat]) await p.join();
  assert.equal((await bee.says(ann, 'before')).elite, undefined, 'somebody never paid has a crown');
  checks++;
  console.log('  ok  nobody has a crown who has not been paid at the top rate');

  // ---- Bee, alive long enough, dies with her tag; Ann carries it its time and cashes it in: paid at the top rate
  await bee.stand(0, 0, 1.6);
  const tag = (owner: string) => ({ uid: `elite-test-tag-${owner}`, id: 'dogtag', qty: 1, owner, held: TAG_HOLD });
  bee.carry([tag('Bee')]);
  await sleep(300);
  bee.send({ t: 'died', cause: 'test' });
  await sleep(400);
  await ann.stand(1, 0, 0.3);
  await ann.takeOff(ann.bodyOf(bee.id), tag('Bee').uid);
  ann.carry([tag('Bee')]);
  await sleep(1500);
  ann.send({ t: 'cash', uid: tag('Bee').uid, wallet: 'So11111111111111111111111111111111111111112' });
  for (let k = 0; k < 60 && !asked.length; k++) await sleep(50);
  assert.equal(asked.length, 1, `the cash-in never reached the site:\n${logged.slice(-800)}`);
  await sleep(400);
  assert.equal((await cat.says(ann, 'crowned')).elite, true, 'paid at the top rate, and no crown on what she says');
  assert.equal((await ann.says(cat, 'not me')).elite, undefined, 'somebody else has her crown');
  await sleep(600);
  ann.send({ t: 'chat', ch: 'near', text: 'near by' });
  await sleep(300);
  assert.equal(ann.got.filter((m): m is Extract<S2C, { t: 'chat' }> => m.t === 'chat' && m.text === 'near by').pop()?.elite, true, 'no crown on what she says to those near');
  checks++;
  console.log('  ok  paid at the top rate, her name has the crown in chat, global and near; nobody else\'s does');

  // ---- Cat, alive long enough, dies with hers; Ann cashes it in, and this time is paid less: the crown is off
  top = false;
  await cat.stand(4, 0, 1.6);
  cat.carry([tag('Cat')]);
  await sleep(300);
  cat.send({ t: 'died', cause: 'test' });
  await sleep(400);
  await ann.stand(5, 0, 0.3);
  await ann.takeOff(ann.bodyOf(cat.id), tag('Cat').uid);
  ann.carry([tag('Cat')]);
  await sleep(1500);
  ann.send({ t: 'cash', uid: tag('Cat').uid, wallet: 'So11111111111111111111111111111111111111112' });
  for (let k = 0; k < 60 && asked.length < 2; k++) await sleep(50);
  assert.equal(asked.length, 2, `the second cash-in never reached the site:\n${logged.slice(-800)}`);
  await sleep(400);
  assert.equal((await bee.says(ann, 'sold')).elite, undefined, 'paid below the top rate, and the crown still on');
  checks++;
  console.log('  ok  paid below the top rate later (sold), the crown comes off');
} catch (e) {
  failed = e;
} finally {
  server.kill();
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
console.log(`\n${checks} checks passed`);
process.exit(0);
