// Dead is dead for everybody, and nobody is left dead with no way back (server/index.ts `kill`, 'respawn').
// 2026-10-12: "when a player got killed they died and before they hit respawn their player model spawned again over
// their dead body and was looking around etc but they couldn't move". What has to hold:
//   - from a death to a respawn, every position of the dead that is passed on says dead, whatever their own game
//     sends, and nobody is told they are back;
//   - a respawn asked for by somebody who is alive here but dead by their own game is not thrown away (they were
//     left looking at the word Respawn for good): it is taken as a death, and then they come back;
//   - a respawn asked for by somebody alive and saying so is still nothing.
// The real server on a port of its own, players over the wire. About fifteen seconds.
//   npx tsx test/death.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { F_DEAD, PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8149;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public name: string, public key = `death-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async join(): Promise<boolean> {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    if (!w) return false;
    this.id = w.you;
    return true;
  }
  send(m: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  /** where they are, as their game says it: with or without the word that they are dead */
  say(x: number, z: number, flags = 0, yaw = 0) {
    this.send({ t: 's', p: [x, ground(x, z), z, yaw, 0, flags], w: null, m: [] });
  }
  count<T extends S2C['t']>(t: T, of?: (m: Extract<S2C, { t: T }>) => boolean) {
    return this.got.filter((m) => m.t === t && (!of || of(m as Extract<S2C, { t: T }>))).length;
  }
  /** the positions of somebody that this player has been sent since `from` messages ago */
  rows(who: Player, from = 0) {
    return this.got.slice(from).flatMap((m) => (m.t === 'ps' ? m.s.filter((r) => r[0] === who.id) : []));
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-death-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', WALLS: 'off', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let checks = 0, failed: unknown = null;
try {
  for (let k = 0; k < 1800 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const ann = new Player('Ann'), vic = new Player('Vic');
  for (const p of [ann, vic]) assert.ok(await p.join());
  ann.say(20, 0);
  vic.say(50, 0);
  await sleep(400);

  // ---- when a position was true by the clock of the game it is of goes on with it (src/net/timeline.ts); a game
  // that says no time is passed on with none, and something that is not a time is not passed on as one
  {
    const mark = ann.got.length;
    vic.send({ t: 's', p: [50, ground(50, 0), 0, 0.2, 0, 0], w: null, m: [], n: 4_321_987.4 });
    await sleep(250);
    assert.ok(ann.rows(vic, mark).some((r) => r[9] === 4_321_987), 'the time a position was true was not passed on with it');
    const mark2 = ann.got.length;
    vic.send({ t: 's', p: [50, ground(50, 0), 0, 0.3, 0, 0], w: null, m: [], n: 'soon' });
    await sleep(250);
    const rows = ann.rows(vic, mark2);
    assert.ok(rows.length > 0 && rows[rows.length - 1][9] == null, 'what is not a time was passed on as one');
    checks++;
    console.log('  ok  the time a position was true goes on with it, and only a time does');
  }

  // ---- dead, and looking about on the death screen: dead in every position passed on, and nobody told otherwise
  vic.send({ t: 'died', cause: 'injuries', v: 1 });
  await sleep(300);
  assert.equal(ann.count('death', (m) => m.k.id === vic.id), 1, 'the death was not told');
  let mark = ann.got.length;
  for (let k = 0; k < 16; k++) {
    // (a game that says so, and then one that does not: one that had not heard yet, or never will)
    vic.say(50, 0, k < 8 ? F_DEAD : 0, k * 0.3);
    ann.say(20, 0);
    await sleep(120);
  }
  const dead = ann.rows(vic, mark);
  assert.ok(dead.length >= 10, `too few positions of the dead were passed on to judge by: ${dead.length}`);
  assert.ok(dead.every((r) => r[6] & F_DEAD), 'a position of somebody dead was passed on without the word that they are dead');
  assert.equal(ann.count('alive', (m) => m.id === vic.id), 0, 'somebody dead was said to be back before they asked to be');
  checks++;
  console.log('  ok  from a death to a respawn every position of the dead says dead, whatever their game sends');

  // ---- they ask to come back: told where, and everybody told they are back
  vic.send({ t: 'respawn' });
  await sleep(300);
  assert.equal(vic.count('spawn'), 1, 'whoever asked to come back was not told where');
  assert.equal(ann.count('alive', (m) => m.id === vic.id), 1, 'nobody was told they are back');
  checks++;
  console.log('  ok  a respawn brings them back, and says so');

  // ---- alive here, and their own game still dead (it never acted on that): they press Respawn again
  mark = ann.got.length;
  for (let k = 0; k < 8; k++) {
    vic.say(50, 0, F_DEAD, k * 0.3);
    ann.say(20, 0);
    await sleep(120);
  }
  // (what they say of themselves is what is passed on: nobody draws them standing: see RemotePlayer.seenDead)
  assert.ok(ann.rows(vic, mark).slice(-4).every((r) => r[6] & F_DEAD), 'their own word that they are dead was not passed on');
  vic.send({ t: 'respawn' });
  await sleep(300);
  assert.equal(vic.count('spawn'), 2, 'somebody dead on their own screen and alive here pressed Respawn and nothing happened');
  assert.equal(ann.count('death', (m) => m.k.id === vic.id), 2, 'the death the server had missed was not told');
  assert.equal(ann.count('alive', (m) => m.id === vic.id), 2, 'nobody was told they are back the second time');
  checks++;
  console.log('  ok  dead on their own screen and alive on the server: Respawn is a death and then a return, not nothing');

  // ---- alive and saying so: a respawn asked for is nothing
  const at = vic.got.filter((m) => m.t === 'spawn').pop() as { x: number; z: number };
  for (let k = 0; k < 4; k++) {
    vic.say(at.x, at.z, 0);
    await sleep(120);
  }
  vic.send({ t: 'respawn' });
  await sleep(300);
  assert.equal(vic.count('spawn'), 2, 'somebody alive was moved to a spawn by asking');
  assert.equal(ann.count('death', (m) => m.k.id === vic.id), 2, 'somebody alive was killed by asking to respawn');
  checks++;
  console.log('  ok  alive and saying so: asking to respawn does nothing');
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
console.log(`\n${checks} checks passed`);
process.exit(0);
