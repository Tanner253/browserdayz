// Tabbed out (server/gate.ts, TABBED): a game that says nothing for the time set has its player taken off the server,
// saved where they stood, as with the proper leave (the owner, 2026-10-14: "players who are tabbed out for 60 seconds
// should get removed from the server"); a hit meanwhile starts the time again; a game that talks is never touched.
// The real server on a port of its own, with three seconds for the minute. About twenty seconds.
//   npx tsx test/tabbed.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8217, TABBED = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  constructor(public name: string, public key = `tabbed-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async join(): Promise<boolean> {
    this.got = [];
    this.shut = false;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
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
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  say(x: number, z: number, w: string | null = null) {
    this.send({ t: 's', p: [x, ground(x, z), z, 0, 0, 0], w, m: [] });
  }
  /** what their game says they carry and how they are (a character is kept only once it has been told) */
  carry(health = 100) {
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [] }, vitals: { health, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
  kicked() {
    return this.got.find((m) => m.t === 'kick') as Extract<S2C, { t: 'kick' }> | undefined;
  }
  sawLeave(id: number) {
    return this.got.some((m) => m.t === 'leave' && m.id === id);
  }
}
const healthz = async () => (await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json()) as { players: number; asleep: number };

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-tabbed-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', TABBED_S: String(TABBED), FRESH_S: '0.2' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let checks = 0, failed: unknown = null, talk: NodeJS.Timeout | undefined;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);

  // Bob's game answers all through, as a game in front of its player does
  const bob = new Player('Bob');
  assert.ok(await bob.join());
  bob.say(31, 0, 'knife');
  talk = setInterval(() => bob.say(31, 0, 'knife'), 300);

  // ---- Ann's tab is put behind another: a word of where she stands, then nothing
  const ann = new Player('Ann');
  assert.ok(await ann.join());
  ann.say(40, 0);
  ann.carry(83);
  await sleep(1500);
  assert.ok(!ann.shut, 'taken off well before the time');
  for (let k = 0; k < 40 && !ann.shut; k++) await sleep(100);
  assert.ok(ann.shut && /tabbed out/.test(ann.kicked()?.reason ?? ''), `a game that said nothing for ${TABBED} s was not taken off: ${JSON.stringify(ann.kicked())}`);
  assert.ok(/saved where you stood/.test(ann.kicked()!.reason), 'not told that their character is kept');
  await sleep(300);
  assert.ok(bob.sawLeave(ann.id), 'the others were not told that she went');
  assert.equal((await healthz()).asleep, 0, 'whoever is taken off for being tabbed out left a body behind');
  checks++;
  console.log('  ok  a game that says nothing for the time has its player taken off, told why, and no body left behind');

  const back = new Player('Ann', ann.key);
  assert.ok(await back.join());
  const w = back.got.find((m) => m.t === 'welcome') as { spawn: { x: number; z: number }; me?: { vitals: { health: number } } };
  assert.ok(Math.hypot(w.spawn.x - 40, w.spawn.z) < 1 && w.me?.vitals.health === 83, `not back where and as she was: ${JSON.stringify(w.spawn)} ${JSON.stringify(w.me?.vitals)}`);
  back.ws.close();
  checks++;
  console.log('  ok  back in, they are where and as they were');

  // ---- Cat's tab goes behind another beside Bob, and Bob hits her two seconds in: the time starts again
  const cat = new Player('Cat');
  assert.ok(await cat.join());
  cat.say(30, 0);
  await sleep(2000);
  bob.send({ t: 'hit', to: cat.id, w: 'knife', zone: 'arms' });
  await sleep(2300);
  assert.ok(!cat.shut, `somebody hit while tabbed out was taken off ${TABBED} s after their game last spoke, not after the hit`);
  for (let k = 0; k < 40 && !cat.shut; k++) await sleep(100);
  assert.ok(cat.shut && /tabbed out/.test(cat.kicked()?.reason ?? ''), 'somebody hit while tabbed out was never taken off');
  checks++;
  console.log('  ok  a hit while tabbed out starts the time again, as it calls off the wait to leave');

  assert.ok(!bob.shut && !bob.kicked(), 'a game that kept talking was taken off');
  checks++;
  console.log('  ok  a game that talks is never touched');
} catch (e) {
  failed = e;
} finally {
  if (talk) clearInterval(talk);
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
console.log(`\n${checks} checks passed`);
process.exit(0);
