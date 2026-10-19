// How far off a shot is heard (src/sim/heard.ts), and that the server passes a shot on to nobody further off than that
// (server/handle.ts 'shot', broadcastNear). The real server on a port of its own, and four players over the wire, at
// 0, 300, 900 and 2,000 metres from whoever fires. About twenty seconds.   npx tsx test/heard.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { heardShare, shotHeard } from '../src/sim/heard';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8283;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (name: string) => console.log(`  ok  ${(checks++, name)}`);

// ---- the figures
assert.deepEqual(shotHeard('barrett', false), [750, 1100]);
assert.deepEqual(shotHeard('sniper50', false), [750, 1100]);
assert.deepEqual(shotHeard('ak', false), [450, 800]);
assert.deepEqual(shotHeard('m9', false), [250, 500]);
assert.ok(shotHeard('ak', true)[1] < shotHeard('ak', false)[1] / 2, 'a suppressor does not take the reach down');
assert.ok(shotHeard('vssk', false)[1] < shotHeard('ak', false)[1] / 2, 'a gun quieted by build carries as an open one');
assert.ok(shotHeard('barrett', false)[1] > shotHeard('ak', false)[1] && shotHeard('ak', false)[1] > shotHeard('m9', false)[1], 'the .50 is not heard furthest, or a pistol not least');
assert.equal(heardShare([450, 800], 100), 1);
assert.equal(heardShare([450, 800], 800), 0);
let was = 1;
for (let d = 450; d <= 800; d += 10) {
  const s = heardShare([450, 800], d);
  assert.ok(s <= was && s >= 0, `it grows louder further off at ${d} m`);
  was = s;
}
ok('the .50s heard furthest, out to 1,100 m; a rifle 800, a pistol 500; a suppressor under half; steeply gone at the edge');

// ---- the server: passed on as far as each gun is heard, and no further
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public name: string, public x: number) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `heard-test-key-${this.name}-${String(++n).padStart(20, '0')}`, name: this.name }));
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    assert.ok(w, `${this.name} was not let in`);
    this.id = w.you;
  }
  stand() {
    this.ws.send(JSON.stringify({ t: 's', p: [this.x, ground(this.x, 0), 0, 0, 0, 0], w: null, m: [] }));
  }
  heard(from: Player, w: string) {
    return this.got.some((m) => m.t === 'shot' && m.id === from.id && m.w === w);
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-heard-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const gun = new Player('Gun', 0), near = new Player('Near', -300), mid = new Player('Mid', -900), far = new Player('Far', -2000);
  const all = [gun, near, mid, far];
  for (const p of all) await p.join();
  for (let k = 0; k < 3; k++) {
    for (const p of all) p.stand();
    await sleep(300);
  }
  const fire = async (w: string, sup = false) => {
    gun.ws.send(JSON.stringify({ t: 'shot', o: [0, ground(0, 0) + 1.6, 0], d: [1, 0, 0], w, sup }));
    await sleep(500);
  };
  await fire('ak');
  assert.ok(near.heard(gun, 'ak'), 'an AK 300 m off was not heard');
  assert.ok(!mid.heard(gun, 'ak') && !far.heard(gun, 'ak'), 'an AK was passed on 900 m off or further');
  await fire('barrett');
  assert.ok(near.heard(gun, 'barrett') && mid.heard(gun, 'barrett'), 'a .50 900 m off was not heard');
  assert.ok(!far.heard(gun, 'barrett'), 'a .50 was passed on 2 km off');
  await fire('m9');
  assert.ok(near.heard(gun, 'm9') && !mid.heard(gun, 'm9'), 'a pistol was not heard 300 m off, or was 900 m off');
  ok('the server passes a shot on to whoever is within earshot of that gun: an AK to 300 m and not 900, a .50 to 900 and not 2 km, a pistol to 300');
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) throw failed;
console.log(`\n${checks} checks passed`);
