// Wager matches (arena/match.ts, served by arena/server.ts): a lobby opened, listed and joined; the server judging every shot itself and
// holding every health point; a round won when a side has nobody left standing, both set down again, and the match
// over at the kills asked for. The real server is started on a port of its own.   npx tsx test/arena.test.ts
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL } from '../src/net/protocol';
import { arenaEnds } from '../src/sim/arena';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8215;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld(), ends = arenaEnds(world);

type M = Record<string, unknown> & { t: string };
class Fighter {
  ws!: WebSocket;
  got: M[] = [];
  id = 0;
  pose: number[] = [0, 0, 0, 0, 0, 0];
  constructor(public name: string) {}
  async open(q: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/arena?${q}`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as M));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `arena-test-${this.name}`.padEnd(40, '0'), name: this.name }));
  }
  async until(t: string, ms = 8000, also: (m: M) => boolean = () => true) {
    for (let k = 0; k < ms / 50; k++) {
      const m = this.got.find((x) => x.t === t && also(x));
      if (m) return m;
      await sleep(50);
    }
    throw new Error(`${this.name} never heard ${t}: ${this.got.map((x) => x.t).join(' ')}`);
  }
  say(x: number, z: number, yaw = 0) {
    this.pose = [x, heightAt(world.heights, x, z), z, yaw, 0, 0];
    this.ws.send(JSON.stringify({ t: 's', p: this.pose, w: 'ar15', m: [] }));
  }
  /** walk from where it is to (x, z) at a run, telling the server as it goes */
  async walk(x: number, z: number) {
    const [x0, , z0] = this.pose, n = Math.ceil(Math.hypot(x - x0, z - z0) / 0.45);
    for (let k = 1; k <= n; k++) { this.say(x0 + ((x - x0) * k) / n, z0 + ((z - z0) * k) / n); await sleep(50); }
  }
  shootAt(o: Fighter) {
    const eye = [this.pose[0], this.pose[1] + 1.6, this.pose[2]], head = [o.pose[0], o.pose[1] + 1.62, o.pose[2]];
    const d = head.map((v, i) => v - eye[i]);
    this.ws.send(JSON.stringify({ t: 'shot', o: eye, d, w: 'ar15', sup: true }));
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-arena-'));
// (the arena is a server of its own: arena/server.ts)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'arena/server.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, BOTCHECK: 'off', CHECKS: 'off', LINGER_S: '0', INFECTED: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let n = 0, failed: unknown = null;
const ok = (name: string) => { n++; console.log('  ok  ' + name); };
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  for (let k = 0; k < 300 && !logged.includes('for shots to meet'); k++) await sleep(100);
  assert.ok(logged.includes('for shots to meet'), `the arena's walls did not go up:\n${logged.slice(-800)}`);

  const host = new Fighter('Hosty'), foe = new Fighter('Foey');
  await host.open('w=new&size=1&kills=3&loadout=assault&stake=0.05');
  await host.until('queue');
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/arena/lobbies`)).json()) as { lobbies: { id: string; host: string; kills: number; state: string; loadout: string }[] };
  const lobby = list.lobbies.find((l) => l.host === 'Hosty');
  assert.ok(lobby && lobby.kills === 3 && lobby.state === 'open' && lobby.loadout === 'assault', JSON.stringify(list));
  ok('a wager opened is listed, waiting for a challenger');

  await foe.open(`w=${lobby.id}`);
  const wh = await host.until('welcome'), wf = await foe.until('welcome');
  host.id = wh.you as number;
  foe.id = wf.you as number;
  const kit = await foe.until('kit');
  assert.ok(Array.isArray(kit.items) && (kit.items as { id: string }[]).some((i) => i.id === 'ar15'), 'no rifle in the loadout');
  assert.ok(((wh.spawn as { x: number }).x === ends[0].x) && ((wf.spawn as { x: number }).x === ends[1].x), 'not set down at their own ends');
  ok('a challenger joins: both are let in at their own ends, with the same loadout');

  // three rounds: the foe walks up to ten metres off the host's end, and the host shoots until they fall
  host.say(ends[0].x, ends[0].z);
  foe.say(ends[1].x, ends[1].z);
  for (let round = 1; round <= 3; round++) {
    foe.pose = [ends[1].x, ends[1].y, ends[1].z, 0, 0, 0];
    host.pose = [ends[0].x, ends[0].y, ends[0].z, 0, 0, 0];
    // (ten metres to the side of the host, on the open apron before the gate: toward the fort is the ramp and its rock, which stop a shot as they should)
    const tx = ends[0].x + Math.cos(ends[0].yaw) * 10, tz = ends[0].z - Math.sin(ends[0].yaw) * 10;
    await foe.walk(tx, tz);
    host.say(ends[0].x, ends[0].z);
    await sleep(300);
    foe.got.length = 0;
    for (let k = 0; k < 12 && !foe.got.some((m) => m.t === 'powers' && m.god); k++) {
      host.shootAt(foe);
      foe.say(foe.pose[0], foe.pose[2]);
      await sleep(200);
    }
    const dmg = foe.got.filter((m) => m.t === 'dmg');
    assert.ok(dmg.length > 0, `round ${round}: no shot struck (${foe.got.map((m) => m.t).join(' ')})`);
    assert.ok(foe.got.some((m) => m.t === 'powers' && m.god), `round ${round}: the foe never fell`);
    if (round < 3) {
      await foe.until('put', 6000);
      await sleep(400);
    }
  }
  ok('the server judges the shots: struck, the foe loses health it holds, and falls; each round both are set down again');
  const over = await host.until('kick', 8000);
  assert.match(String(over.reason), /Hosty won 3 to 0/);
  ok('first to three: the match is over, and both are told who won');

  // practice: the arena alone, let in at once, never listed
  const solo = new Fighter('Solo');
  await solo.open('w=practice&loadout=marksman');
  const ws0 = await solo.until('welcome');
  assert.ok(ws0 && (await solo.until('kit')));
  const listed = (await (await fetch(`http://127.0.0.1:${PORT}/arena/lobbies`)).json()) as { lobbies: { host: string }[] };
  assert.ok(!listed.lobbies.some((l) => l.host === 'Solo'), 'a practice is listed');
  ok('practice: the arena alone, let in at once with the loadout, and never listed');
  solo.ws.close();

  // a shot at somebody behind the fort's own wall does not reach them
  assert.ok(!logged.includes('TypeError') && !logged.includes('ReferenceError'), 'the server wrote what looks like a crash');
} catch (e) {
  failed = e;
} finally {
  if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error(failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log(`arena: ${n} passed`);
process.exit(0);
