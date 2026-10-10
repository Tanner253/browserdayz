// A tag taken off somebody and carried out of the Zona is void after TAG_OUT seconds, and it is the server
// that says so. This starts the real server on a port of its own and plays two players against it over the
// wire: one dies, the other carries the tag over the line. It takes about half a minute (the rule is in
// seconds of the clock).   npx tsx test/zone.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { TAG_HOLD, TAG_OUT } from '../src/sim/items';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { inPlay } from '../src/world/worldgen';

const PORT = 8137;
const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-zone-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  // (somebody has to have lived three seconds here before there is a tag on them: five minutes, in the game)
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', TAG_FRESH_S: '3' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout.on('data', (d) => (logged += d));
server.stderr.on('data', (d) => (logged += d));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public key: string, public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.send({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name });
    const w = await this.wait('welcome');
    this.id = (w as { you: number }).you;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async wait(t: string, ms = 8000) {
    for (let k = 0; k < ms / 50; k++) {
      const m = this.got.find((x) => x.t === t);
      if (m) return m;
      await sleep(50);
    }
    throw new Error(`${this.name} was never sent '${t}'`);
  }
  /** stand at a place for so long, saying so ten times a second as the game does */
  async stand(x: number, z: number, seconds: number) {
    for (let k = 0; k < seconds * 10; k++) {
      this.send({ t: 's', p: [x, 20, z, 0, 0, 0], w: null, m: [] });
      await sleep(100);
    }
  }
  carry(tags: object[]) {
    this.send({ t: 'me', inv: { slots: Object.fromEntries(tags.map((t, i) => [`s${i}`, t])), active: null, containers: [] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
}

const IN: [number, number] = [0, 0], OUT: [number, number] = [470, 470];
let failed: unknown = null;
try {
  assert.ok(inPlay(...IN) && !inPlay(...OUT), 'the two places of this test are not one inside the Zona and one outside');
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);

  const ann = new Player('zone-test-key-ann-000000000000000001', 'Ann'), bee = new Player('zone-test-key-bee-000000000000000002', 'Bee');
  await ann.join();
  await bee.join();
  // Cid has only just arrived when he dies: there is no tag on him, and carrying his changes nothing for anybody
  const cid = new Player('zone-test-key-cid-000000000000000003', 'Cid');
  await cid.join();
  const fresh = { uid: 'zone-test-tag-cid', id: 'dogtag', qty: 1, owner: 'Cid', held: TAG_HOLD };
  cid.carry([fresh]);
  await sleep(300);
  cid.send({ t: 'died', cause: 'test' });
  await sleep(400);
  assert.ok(/Cid left no dog tag/.test(logged), 'a tag was left on somebody who had only just arrived');
  // (Bee has been alive long enough by the time she dies)
  await sleep(3200);
  // Bee dies with her own tag round her neck: the server now knows that tag as one that can be taken
  const tag = { uid: 'zone-test-tag-bee', id: 'dogtag', qty: 1, owner: 'Bee', held: TAG_HOLD };
  bee.carry([tag]);
  await sleep(300);
  bee.send({ t: 'died', cause: 'test' });
  await sleep(500);
  // Ann has it in her pockets, and her own as well (which is nobody's business)
  const hers = { uid: 'zone-test-tag-ann', id: 'dogtag', qty: 1, owner: 'Ann' };
  ann.carry([tag, hers, fresh]);
  assert.ok(!/Bee left no dog tag/.test(logged), 'no tag on somebody who had lived long enough');

  // inside the line nothing happens, however long
  await ann.stand(...IN, 2);
  assert.equal(ann.got.filter((m) => m.t === 'void').length, 0, 'tags were called void inside the Zona');

  // over the line and back before the time is up: nothing, and the clock starts again from nothing
  await ann.stand(...OUT, TAG_OUT - 5);
  await ann.stand(...IN, 1);
  await ann.stand(...OUT, TAG_OUT - 5);
  assert.equal(ann.got.filter((m) => m.t === 'void').length, 0, 'two short walks outside were counted as one long one');

  // and now she stays out
  await ann.stand(...OUT, 6.5);
  const gone = ann.got.filter((m) => m.t === 'void') as { t: 'void'; uids: string[] }[];
  assert.equal(gone.length, 1, `she was told ${gone.length} times`);
  assert.deepEqual(gone[0].uids, [tag.uid], 'not the tag she took and that alone (her own is hers wherever she goes, and Cid had none to take)');

  // she is not told again for the same tag, though she stays out and (a cheat) says she still has it
  ann.carry([tag, hers, fresh]);
  await ann.stand(...OUT, 2);
  assert.equal(ann.got.filter((m) => m.t === 'void').length, 1);
  // and cashing it in is refused, in so many words
  ann.send({ t: 'cash', uid: tag.uid, wallet: '' });
  await sleep(600);
  const told = ann.got.filter((m) => m.t === 'tell').map((m) => (m as { text: string }).text);
  assert.ok(told.some((s) => /out of the Zona/.test(s)), `she was not told why there is no reward: ${JSON.stringify(told)}`);
  assert.ok(/carried 1 dog tag out of the Zona/.test(logged), 'the server kept no line of it');
  assert.ok(!/recorded|listed for a reward\b(?!:)/.test(logged.split('carried 1 dog tag')[1] ?? ''), 'something was listed for a reward afterwards');
  ann.ws.close();
  bee.ws.close();
  console.log('  ok  a tag carried out of the Zona is void after', TAG_OUT, 'seconds, not before, not inside, and never her own; and nobody who has just arrived leaves a tag');
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(300);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the server still letting go of it */
  }
}
if (failed) {
  console.error(logged.slice(-800));
  throw failed;
}
console.log('1 check passed');
process.exit(0);
