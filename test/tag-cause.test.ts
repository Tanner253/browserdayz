// No dog tag from a death no other player caused (the owner, 2026-10-18, of bots that lived out the tag's time and then
// had their own game say they "died of wounds", leaving a tag for their partner): a body keeps its owner's tag only if
// another player's hit came within TAG_CAUSE_S before the death (server/acts.ts, makeCorpse). And the course's judging
// of an aim out in the world (server/aimwatch.ts): hits landed while looking far away are written down, and three send
// the shooter back to the bot check. The real server on a port of its own, with short times, and players over the wire.
// About a minute.
//   npx tsx test/tag-cause.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8251;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public name: string, public key = `tag-cause-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.send({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name });
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    assert.ok(w, `${this.name} was not let in`);
    this.id = w.you;
  }
  send(m: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  say(x: number, z: number, w: string | null = null) {
    this.send({ t: 's', p: [x, ground(x, z), z, 0, 0, 0], w, m: [] });
  }
  /** their own tag on them, and whatever else */
  carry(slots: Record<string, object> = {}) {
    this.send({ t: 'me', inv: { slots, active: null, containers: [{ id: 'tags', items: [{ uid: `own-${this.name}`, id: 'dogtag', qty: 1, owner: this.name, x: 0, y: 0, rot: false }] }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
  sawDie(who: Player) {
    return this.got.some((m) => m.t === 'death' && m.k.id === who.id);
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-tag-cause-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', WALLS: 'off', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'off', TAG_FRESH_S: '1', TAG_MIN_LIFE_S: '1', FRESH_S: '0.2' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let checks = 0, failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const ann = new Player('Ann'), bee = new Player('Bee'), dan = new Player('Dan'), eve = new Player('Eve');
  for (const p of [ann, bee, dan, eve]) await p.join();
  // (each says where they are as a game does, every moment: a life's time toward its tag is counted inside the Zona at each word)
  const at = new Map([ann, bee, dan].map((p) => [p, 20 + n++]));
  for (let t = 0; t < 2000; t += 400) {
    for (const [p, x] of at) p.say(x, 0);
    await sleep(400);
  }

  // ---- Bee's own game says she died of her wounds, with nobody near: no tag on her body
  bee.carry();
  await sleep(300);
  bee.send({ t: 'died', cause: 'wounds' });
  for (let k = 0; k < 40 && !logged.includes('Bee died'); k++) await sleep(100);
  assert.ok(logged.includes('Bee left no dog tag: no other player killed them'), `Bee's tag was left on her body:\n${logged.slice(-800)}`);
  checks++;
  console.log('  ok  a death no other player caused leaves no dog tag');

  // ---- Ann shoots Dan dead: his tag is on his body
  dan.carry();
  ann.say(30, 0, 'mosin');
  dan.say(31, 0);
  await sleep(400);
  for (let k = 0; k < 8 && !ann.sawDie(dan); k++) {
    ann.send({ t: 'hit', to: dan.id, w: 'mosin', zone: 'torso' });
    await sleep(900);
  }
  assert.ok(ann.sawDie(dan), `Ann's shots did not kill Dan:\n${logged.slice(-800)}`);
  await sleep(300);
  assert.ok(!logged.includes('Dan left no dog tag'), `Dan's tag was not left on his body:\n${logged.slice(-800)}`);
  checks++;
  console.log('  ok  a player shot dead by another leaves their dog tag');

  // ---- Ann hits Eve, eight metres east of her, three times while looking north: written down, and back to the bot check
  eve.say(48, 0);
  await sleep(5500);
  for (let k = 0; k < 3; k++) {
    for (let t = 0; t < 4; t++) {
      ann.say(40, 0, 'm9');
      await sleep(60);
    }
    ann.send({ t: 'hit', to: eve.id, w: 'm9', zone: 'legs' });
    await sleep(1100);
  }
  assert.match(logged, /Ann hit Eve while looking 9\d degrees away from them/, `a hit while looking away was not written down:\n${logged.slice(-800)}`);
  assert.match(logged, /Ann would be sent back to the bot check[^\n]*3 hits in ten minutes that a hand could not have aimed/, `three of them did not send her back:\n${logged.slice(-800)}`);
  checks++;
  console.log('  ok  hits landed while looking far away are written down, and three send the shooter back to the bot check');
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) throw failed;
console.log(`${checks} checks passed`);
