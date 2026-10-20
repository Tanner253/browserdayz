// Back after a lost line, a player who died meanwhile is told so (server/players.ts `join`, 2026-10-20: a player, "the
// server just reloads my game out of nowhere and when i get in i spawn fresh"). A game whose line goes quiet in a fight
// is seen and shot by everybody while it shows nothing new; the death reaches the server and not the game, the line
// drops, the page goes back in by itself, and it started again with no word of why.
//   - dead while the line was down, and back: a fresh start, and told how they died;
//   - alive when the line dropped, and back: their body back, nothing said of a death;
//   - dead, brought back by Respawn, gone and back: their new life back, nothing said of a death.
// About ten seconds.   npx tsx test/died-away.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { F_GROUND, PROTOCOL, type S2C } from '../src/net/protocol';
import { makeItem } from '../src/sim/items';

const PORT = 8297;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (name: string) => {
  checks++;
  console.log('  ok  ' + name);
};

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  welcome: Extract<S2C, { t: 'welcome' }> | null = null;
  constructor(public name: string, public key = `died-away-test-${name}-${String(++n).padStart(20, '0')}`) {}
  async join(): Promise<void> {
    this.got = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    this.welcome = (this.got.find((m) => m.t === 'welcome') as Extract<S2C, { t: 'welcome' }>) ?? null;
    assert.ok(this.welcome, `${this.name} was not let in`);
  }
  send(m: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  /** standing where they were set down, with a tin in their pockets, as a game says it */
  async play() {
    const sp = this.welcome!.spawn;
    this.send({ t: 's', p: [sp.x, sp.y ?? 0, sp.z, 0, 0, F_GROUND], w: null, m: [], n: 1 });
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'pockets', items: [{ ...makeItem('beans'), x: 0, y: 0, rot: false }] }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false, blood: 5000, bleed: 0 } });
    await sleep(300);
  }
  /** the line lost with no word (the server sees it end) */
  async drop() {
    this.ws.terminate();
    await sleep(400);
  }
  told() {
    return this.got.filter((m) => m.t === 'tell').map((m) => (m as { text: string }).text);
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-died-away-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', KEEP: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);

  // Dead while the line was down: the death is the server's (here, as a game says it, and then the line goes)
  const ann = new Player('Ann');
  await ann.join();
  await ann.play();
  ann.send({ t: 'died', cause: 'wounds' });
  await sleep(200);
  await ann.drop();
  await ann.join();
  assert.equal(ann.welcome!.me, null, 'Ann, dead, came back as she was');
  ok('dead when the line dropped: back to a fresh start');
  const said = ann.told().find((t) => /died/.test(t));
  assert.ok(said && /wounds/.test(said) && /start again/.test(said), `Ann was not told how she died: ${JSON.stringify(ann.told())}`);
  ok(`and told so: "${said}"`);

  // Alive when the line dropped: given back, and no word of any death
  const cal = new Player('Cal');
  await cal.join();
  await cal.play();
  await cal.drop();
  await cal.join();
  assert.ok(cal.welcome!.me, 'Cal was not given back his body');
  assert.ok(!cal.told().some((t) => /died/.test(t)), `Cal was told of a death: ${JSON.stringify(cal.told())}`);
  ok('alive when the line dropped: given back, nothing said of a death');

  // Dead, brought back by Respawn, then gone and back: his new life, and no word of the old death
  const dee = new Player('Dee');
  await dee.join();
  await dee.play();
  dee.send({ t: 'died', cause: 'a fall' });
  await sleep(200);
  dee.send({ t: 'respawn' });
  for (let k = 0; k < 40 && !dee.got.some((m) => m.t === 'spawn'); k++) await sleep(50);
  await dee.play();
  await dee.drop();
  await dee.join();
  assert.ok(dee.welcome!.me, 'Dee was not given back her new life');
  assert.ok(!dee.told().some((t) => /died/.test(t)), `Dee was told of an old death: ${JSON.stringify(dee.told())}`);
  ok('dead, back by Respawn, gone and back: given back, nothing said of the old death');
  console.log(`\n${checks} checks passed`);
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) {
  console.error(logged.slice(-1500));
  throw failed;
}
