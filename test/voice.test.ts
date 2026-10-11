// Talking to whoever is near (src/game/voice.ts, `voice` in server/index.ts): that a voice gets quieter with
// every step away and is never suddenly there or gone; and, against the real server on a port of its own, that
// what one player says reaches whoever is in earshot and nobody else, marked as theirs, and that nobody can
// flood the others with it.   npx tsx test/voice.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL } from '../src/net/protocol';
import { VOICE, loud } from '../src/sim/voice';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8141;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();

let n = 0;
const ok = (name: string) => {
  console.log(`  ok  ${name}`);
  n++;
};

// ---------------------------------------------------------------- how loud, from how far
{
  assert.equal(loud(0), 1);
  assert.equal(loud(VOICE.near), 1);
  assert.equal(loud(VOICE.range), 0);
  assert.equal(loud(VOICE.range + 50), 0);
  let last = 1;
  for (let d = VOICE.near + 0.5; d <= VOICE.range; d += 0.5) {
    const g = loud(d);
    assert.ok(g < last, `no quieter at ${d} m than half a metre nearer`);
    assert.ok(last - g < 0.03, `a step of ${(last - g).toFixed(3)} in half a metre at ${d} m: that is a threshold, not a fading`);
    last = g;
  }
  // (and it is still speech a good way off: more than half of it at ten metres, some of it at thirty)
  assert.ok(loud(10) > 0.6 && loud(20) > 0.3 && loud(30) > 0.1 && loud(40) < 0.1);
  ok(`a voice fades with distance: ${[2, 10, 20, 30, 40, 45].map((d) => `${d} m ${Math.round(loud(d) * 100)}%`).join(', ')}`);
}

// ---------------------------------------------------------------- over the wire
class Player {
  ws!: WebSocket;
  id = 0;
  heard: Buffer[] = [];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    let welcome: { you: number } | null = null;
    this.ws.on('message', (d, binary) => {
      if (binary) return void this.heard.push(d as Buffer);
      const m = JSON.parse(String(d));
      if (m.t === 'welcome') welcome = m;
    });
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `voice-test-key-${this.name}-${'0'.repeat(20)}`, name: this.name }));
    for (let k = 0; k < 160 && !welcome; k++) await sleep(50);
    assert.ok(welcome, `${this.name} was not let in`);
    this.id = welcome!.you;
  }
  stand(x: number, z: number) {
    this.ws.send(JSON.stringify({ t: 's', p: [x, heightAt(world.heights, x, z), z, 0, 0, 0], w: null, m: [] }));
  }
  /** a piece of speech: [which piece u16][the piece] */
  speak(seq: number, bytes = 40) {
    const b = Buffer.alloc(2 + bytes, seq & 255);
    b.writeUInt16LE(seq, 0);
    this.ws.send(b);
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-voice-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);

  const ann = new Player('Ann'), ben = new Player('Ben'), far = new Player('Far');
  for (const p of [ann, ben, far]) await p.join();
  // Ben ten metres from Ann, Far sixty
  ann.stand(20, 20);
  ben.stand(28, 26);
  far.stand(80, 20);
  await sleep(400);

  for (let k = 0; k < 30; k++) ann.speak(k);
  await sleep(500);
  assert.equal(ben.heard.length, 30, `Ben, ten metres off, heard ${ben.heard.length} of 30 pieces`);
  for (const [k, b] of ben.heard.entries()) {
    assert.equal(b.readUInt16LE(0), ann.id, 'a piece not marked as Ann\'s');
    assert.equal(b.readUInt16LE(2), k, 'the pieces out of order');
    assert.equal(b.length, 44);
  }
  assert.equal(far.heard.length, 0, 'Far, sixty metres off, was sent it');
  assert.equal(ann.heard.length, 0, 'Ann was sent her own voice back');
  ok('what is said reaches whoever is in earshot, marked as the speaker\'s and in order; nobody further off is sent it, nor the speaker');

  // Ben walks off out of earshot, and back in to the edge of it
  ben.stand(20 + VOICE.range + 12, 20);
  await sleep(400);
  ben.heard = [];
  for (let k = 0; k < 10; k++) ann.speak(k);
  await sleep(400);
  assert.equal(ben.heard.length, 0, 'out of earshot, Ben was still sent it');
  ben.stand(20 + VOICE.range - 6, 20);
  await sleep(400);
  for (let k = 0; k < 10; k++) ann.speak(k);
  await sleep(400);
  assert.equal(ben.heard.length, 10, `back inside earshot, Ben heard ${ben.heard.length} of 10`);
  ok('who hears is decided by the server from where each player is, as they move');

  // a piece too big to be speech, and far too many of them
  await sleep(1100);
  ben.heard = [];
  ann.speak(0, VOICE.bytes + 10);
  await sleep(300);
  assert.equal(ben.heard.length, 0, 'a piece bigger than speech was passed on');
  // what a game owes after it has stopped for a second comes all at once, and is passed on whole
  await sleep(4500);
  ben.heard = [];
  for (let k = 0; k < 60; k++) ann.speak(k);
  await sleep(500);
  assert.equal(ben.heard.length, 60, `of 60 pieces sent together after a stop, ${ben.heard.length} were passed on`);
  // and a flood is not: no more than the allowance, then no more than the rate
  await sleep(4500);
  ben.heard = [];
  for (let k = 0; k < 1500; k++) ann.speak(k);
  await sleep(900);
  assert.ok(ben.heard.length >= VOICE.burst - 10 && ben.heard.length <= VOICE.burst + VOICE.rate * 2, `of 1500 pieces sent at once, ${ben.heard.length} were passed on (the allowance is ${VOICE.burst})`);
  ok(`what is owed after a stop is passed on whole, and a flood is not: a piece over ${VOICE.bytes} bytes is dropped, and of 1500 sent at once ${ben.heard.length} were passed on`);

  for (const p of [ann, ben, far]) p.ws.close();
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
console.log(`\n${n} checks passed`);
