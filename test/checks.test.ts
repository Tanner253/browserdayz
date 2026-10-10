// The server's own checks on what a player's game tells it (CHECKS in server/index.ts): that nobody gets
// anywhere faster than legs or a jeep go, and that a round does not pass through a hill. This starts the real
// server twice on a port of its own, once enforcing and once only watching, and plays players against it over
// the wire. About twenty seconds.   npx tsx test/checks.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8139;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  at: [number, number] = [0, 0];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `checks-test-key-${this.name}-${String(++n).padStart(20, '0')}`, name: this.name }));
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    assert.ok(w, `${this.name} was never let in`);
    this.id = w.you;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  /** where they say they are, standing on the ground there, with what they say they hold */
  say(x: number, z: number, w: string | null = null) {
    this.at = [x, z];
    this.send({ t: 's', p: [x, ground(x, z), z, 0, 0, 0], w, m: [] });
  }
  /** where somebody else was last said to be, to this player */
  sees(id: number): [number, number] | null {
    for (let k = this.got.length - 1; k >= 0; k--) {
      const m = this.got[k] as { t: string; s?: number[][] };
      const row = m.t === 'ps' ? m.s?.find((r) => r[0] === id) : undefined;
      if (row) return [row[1], row[3]];
    }
    return null;
  }
}

async function withServer(mode: string, play: (log: () => string) => Promise<void>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-checks-'));
  // (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
  const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: mode },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logged = '';
  server.stdout!.on('data', (d) => (logged += d));
  server.stderr!.on('data', (d) => (logged += d));
  let failed: unknown = null;
  try {
    for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
    assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
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
    console.error(logged.slice(-900));
    throw failed;
  }
}

// two places with a hill between them, and two with nothing between them: found on the map as it is
const over = (a: [number, number], b: [number, number]) => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), ay = ground(...a) + 1.5, by = ground(...b) + 1.1;
  let most = -1e9;
  for (let s = 5; s < d - 5; s += 2) most = Math.max(most, ground(a[0] + ((b[0] - a[0]) * s) / d, a[1] + ((b[1] - a[1]) * s) / d) - (ay + ((by - ay) * s) / d));
  return most;
};
let hidden: [[number, number], [number, number]] | null = null, open: [[number, number], [number, number]] | null = null;
for (let x = -300; x <= 300 && !(hidden && open); x += 20) {
  for (let z = -300; z <= 300 && !(hidden && open); z += 20) {
    const a: [number, number] = [x, z], b: [number, number] = [x + 110, z + 30], h = over(a, b);
    if (!hidden && h > 8) hidden = [a, b];
    if (!open && h < -1.5) open = [a, b];
  }
}
assert.ok(hidden && open, 'the map has no two places with a hill between them, or none with nothing between them');

let checks = 0;
await withServer('enforce', async (log) => {
  // ---- nobody gets anywhere faster than legs go
  const ann = new Player('Ann'), bee = new Player('Bee');
  await ann.join();
  await bee.join();
  bee.say(4, 4);
  // (set down, and a moment given for it: then a run, as fast as anybody runs with nothing in their hands)
  ann.say(0, 0);
  await sleep(2700);
  for (let k = 1; k <= 30; k++) {
    ann.say(k * 0.74, 0);
    bee.say(4, 4);
    await sleep(100);
  }
  await sleep(300);
  assert.ok(!/\[check/.test(log()), `a check fired on somebody running:\n${log().split('\n').filter((l) => l.includes('[check')).join('\n')}`);
  const ran = bee.sees(ann.id);
  assert.ok(ran && Math.abs(ran[0] - 22.2) < 1.5, `Bee sees Ann at ${ran}, and she ran to 22.2, 0`);
  // and then says she is three hundred metres off
  for (let k = 0; k < 8; k++) {
    ann.say(320, 0);
    bee.say(4, 4);
    await sleep(100);
  }
  await sleep(300);
  assert.ok(/\[check:enforce\] Ann moved 29\d m/.test(log()), 'nothing was written down of a jump across the map');
  const kept = bee.sees(ann.id);
  assert.ok(kept && Math.abs(kept[0] - 22.2) < 1.5, `Bee sees Ann at ${kept} after the jump: she is to be kept where she was`);
  // back where she was, she is believed again
  ann.say(23, 0);
  await sleep(400);
  const back = bee.sees(ann.id);
  assert.ok(back && Math.abs(back[0] - 23) < 0.5, `Bee sees Ann at ${back} once she is back where she could be`);
  ann.ws.close();
  bee.ws.close();
  checks++;
  console.log('  ok  a run is a run; a jump across the map is refused, written down, and nobody else sees it');

  // ---- a round does not go through a hill
  const cid = new Player('Cid'), dee = new Player('Dee'), eve = new Player('Eve'), fay = new Player('Fay');
  for (const p of [cid, dee, eve, fay]) await p.join();
  // (each stood where they are to be, in the moment after arriving in which that is not questioned)
  cid.say(...hidden![0], 'mosin');
  dee.say(...hidden![1]);
  eve.say(...open![0], 'mosin');
  fay.say(...open![1]);
  await sleep(300);
  cid.send({ t: 'hit', to: dee.id, w: 'mosin', zone: 'torso' });
  eve.send({ t: 'hit', to: fay.id, w: 'mosin', zone: 'torso' });
  await sleep(600);
  assert.ok(!dee.got.some((m) => m.t === 'dmg'), 'somebody was hit through a hill');
  assert.ok(/\[check:enforce\] Cid shot Dee through/.test(log()), 'nothing was written down of a shot through a hill');
  assert.ok(fay.got.some((m) => m.t === 'dmg'), `somebody in plain sight was not hit:\n${log().slice(-400)}`);
  for (const p of [cid, dee, eve, fay]) p.ws.close();
  checks++;
  console.log('  ok  a round through a hill hits nobody and is written down; one across open ground hits');
});

await withServer('watch', async (log) => {
  // ---- only watching: the same things are written down, and nothing is refused
  const ann = new Player('Ann'), bee = new Player('Bee');
  await ann.join();
  await bee.join();
  ann.say(0, 0);
  bee.say(4, 4);
  await sleep(2700);
  for (let k = 0; k < 6; k++) {
    ann.say(320, 0);
    bee.say(4, 4);
    await sleep(100);
  }
  await sleep(300);
  assert.ok(/\[check:watch\] Ann moved 320 m/.test(log()), 'watching, nothing was written down of a jump across the map');
  const far = bee.sees(ann.id);
  assert.ok(far && Math.abs(far[0] - 320) < 1, `watching, Bee sees Ann at ${far}: nothing is to be refused`);
  const health = (await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json()) as { checks: string; flagged: number };
  assert.ok(health.checks === 'watch' && health.flagged >= 1, `the health page says ${JSON.stringify(health)}`);
  ann.ws.close();
  bee.ws.close();
  checks++;
  console.log('  ok  only watching, the same is written down and counted, and nothing is refused');
});

console.log(`${checks} checks passed`);
process.exit(0);
