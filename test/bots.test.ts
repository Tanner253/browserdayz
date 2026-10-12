// Connections made by a program, and what honest players paid for them (2026-10-12: "someone is attacking the
// server with bot accounts"; "people swear they only have 1 window open but then get blocked"). What has to hold:
//   - a connection whose game never says where it stands is put out, and leaves no body;
//   - a life new to the world that goes within its first minute leaves no body;
//   - a body left behind does not count as somebody playing from its address, nor hold a place on a full server;
//     somebody awake at an address still does;
//   - more hellos from one address in a minute than a game sends are turned away;
//   - where it is asked, a connection not asked for by the game's own page is not taken.
// The real server on ports of its own, connections over the wire. About twenty-five seconds.
//   npx tsx test/bots.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
let n = 0;

class Conn {
  ws!: WebSocket;
  got: S2C[] = [];
  open = false;
  closed = false;
  constructor(public port: number, public name: string, public ip = '', public origin = '', public key = `bots-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
  /** @returns welcomed, refused (with the reason given), or not taken at all */
  async hello(): Promise<'in' | 'refused' | 'waiting' | 'no'> {
    const headers: Record<string, string> = {};
    if (this.ip) headers['x-forwarded-for'] = this.ip;
    if (this.origin) headers.origin = this.origin;
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`, { headers });
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.closed = true));
    const up = await new Promise<boolean>((done) => {
      this.ws.once('open', () => done(true));
      this.ws.once('error', () => done(false));
    });
    if (!up) return 'no';
    this.open = true;
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 100; k++) {
      if (this.got.some((m) => m.t === 'welcome')) return 'in';
      if (this.got.some((m) => m.t === 'kick')) return 'refused';
      if (this.got.some((m) => m.t === 'queue')) return 'waiting';
      await sleep(50);
    }
    return 'no';
  }
  why() {
    return (this.got.find((m) => m.t === 'kick') as { reason?: string } | undefined)?.reason ?? '';
  }
  say(x = 20, z = 0) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 's', p: [x, heightAt(world.heights, x, z), z, 0, 0, 8], w: null, m: [], n: Math.round(performance.now()) }));
  }
  /** says where it is for a while, as a game does */
  async play(ms: number, x = 20, z = 0) {
    for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
      this.say(x, z);
      await sleep(100);
    }
  }
  leave() {
    this.ws.terminate();
  }
}

const dirs: string[] = [], servers: ChildProcess[] = [];
async function server(port: number, env: Record<string, string>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-bots-'));
  dirs.push(dir);
  // (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
  const s = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', RENDER: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(s);
  let logged = '';
  s.stdout!.on('data', (d) => (logged += d));
  s.stderr!.on('data', (d) => (logged += d));
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  return { health: async () => (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()) as { players: number; asleep: number; unspoken: number; turned: Record<string, number> }, log: () => logged };
}

let checks = 0, failed: unknown = null;
const ok = (what: string) => {
  checks++;
  console.log(`  ok  ${what}`);
};
try {
  // ---- a body is left after two seconds in the world here, and a game that says nothing goes after three
  const A = 8161;
  const a = await server(A, { FRESH_S: '2', NEVER_SPOKE_S: '3', MAX_PLAYERS: '2', HELLOS_A_MINUTE: '6' });

  // a connection that never says where it stands: put out, and no body
  {
    const bot = new Conn(A, 'Mute', '8.8.4.1');
    assert.equal(await bot.hello(), 'in');
    assert.equal((await a.health()).unspoken, 1, 'somebody who has said nothing is not counted as such');
    await sleep(5000);
    assert.ok(bot.closed, 'a connection that never said where it stood was left in the world');
    assert.match(bot.why(), /did not start/, 'it was not told why');
    const h = await a.health();
    assert.deepEqual([h.players, h.asleep], [0, 0], `it left something behind: ${JSON.stringify(h)}`);
    assert.equal(h.turned.silent, 1);
    ok('a connection whose game never says where it stands is put out, and leaves no body');
  }

  // new to the world and gone at once: no body
  {
    const quick = new Conn(A, 'Quick', '8.8.4.2');
    assert.equal(await quick.hello(), 'in');
    await quick.play(600);
    quick.leave();
    await sleep(700);
    const h = await a.health();
    assert.deepEqual([h.players, h.asleep], [0, 0], `somebody new who went at once left a body: ${JSON.stringify(h)}`);
    ok('a life new to the world that goes within its first while leaves no body');
  }

  // somebody who played leaves a body; it does not hold their address against another key, nor a place on a full server
  {
    const ann = new Conn(A, 'Ann', '8.8.4.3');
    assert.equal(await ann.hello(), 'in');
    const twin = new Conn(A, 'Twin', '8.8.4.3');
    void ann.play(1200);
    assert.equal(await twin.hello(), 'refused', 'two awake at one address were both let in');
    assert.match(twin.why(), /already playing from your connection/);
    await ann.play(2600);
    ann.leave();
    await sleep(700);
    let h = await a.health();
    assert.deepEqual([h.players, h.asleep], [0, 1], `somebody who had played left no body: ${JSON.stringify(h)}`);
    // (the same person, as far as the server can tell, in another browser: let in)
    const again = new Conn(A, 'AnnAgain', '8.8.4.3');
    assert.equal(await again.hello(), 'in', `kept out by a body left behind at their own address: ${again.why()}`);
    void again.play(4000);
    // (a server of two places: one awake, one body. The second place is free.)
    const other = new Conn(A, 'Other', '8.8.4.9');
    assert.equal(await other.hello(), 'in', 'a body left behind held a place on a full server');
    void other.play(3000);
    await sleep(300);
    h = await a.health();
    assert.deepEqual([h.players, h.asleep], [2, 1], JSON.stringify(h));
    // (and now it IS full: the next waits in line)
    const third = new Conn(A, 'Third', '8.8.4.10');
    assert.equal(await third.hello(), 'waiting', 'a third was let into a server of two places');
    third.leave();
    again.leave();
    other.leave();
    ok('a body left behind holds neither its address nor a place; somebody awake holds both');
  }

  // hellos by the dozen from one address
  {
    const out: string[] = [];
    for (let k = 0; k < 9; k++) {
      const c = new Conn(A, `Flood${k}`, '8.8.4.20', '', `bots-test-key-flood-00000000000000000000`);
      out.push(await c.hello());
      c.leave();
      await sleep(60);
    }
    assert.ok(out.slice(0, 6).every((r) => r === 'in'), `an honest few were turned away: ${out.join(' ')}`);
    assert.ok(out.slice(6).every((r) => r === 'refused'), `the flood was let in: ${out.join(' ')}`);
    assert.ok((await a.health()).turned.flood >= 3);
    ok('more hellos from one address in a minute than a game sends are turned away');
  }

  // ---- where it is asked whose page a connection is asked for from
  const B = 8162;
  const b = await server(B, { ORIGINS: 'game.example' });
  {
    assert.equal(await new Conn(B, 'NoPage', '8.8.5.1').hello(), 'no', 'a connection from no page at all was taken');
    assert.equal(await new Conn(B, 'Elsewhere', '8.8.5.2', 'https://evil.example').hello(), 'no', 'a connection from another page was taken');
    const real = new Conn(B, 'Real', '8.8.5.3', 'https://www.game.example');
    assert.equal(await real.hello(), 'in', 'the game\'s own page was turned away');
    real.leave();
    assert.equal((await b.health()).turned.origin, 2);
    ok('a connection not asked for by the game\'s own page is not taken');
  }

  // ---- enforcing: flagged so many times, and out
  const C = 8163;
  const c = await server(C, { CHECKS: 'enforce', FLAGS_OUT: '5' });
  {
    const leaper = new Conn(C, 'Leaper', '8.8.6.1');
    assert.equal(await leaper.hello(), 'in');
    await leaper.play(3200);
    // (across the map in one step, said eight times: each is refused and written down)
    for (let k = 0; k < 8 && !leaper.closed; k++) {
      leaper.say(320, 0);
      await sleep(120);
    }
    await sleep(400);
    assert.ok(leaper.closed, `somebody flagged five times and more was left in:\n${c.log().slice(-400)}`);
    assert.match(leaper.why(), /flagged what your game was doing too many times/);
    assert.equal((await c.health()).turned.flags, 1);
    ok('enforcing, somebody the checks have flagged so many times is put out');
  }
} catch (e) {
  failed = e;
} finally {
  for (const s of servers) s.kill();
  await sleep(300);
  for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* still letting go */ }
}
if (failed) {
  console.error(failed);
  process.exit(1);
}
console.log(`\n${checks} checks passed`);
process.exit(0);
