// The first minute in the world, over the wire (the owner, 2026-10-15: "we need to detect bots within a minute of
// joining. waiting for longer could allow the bots to learn or cash tags"). What has to hold, with the checks
// enforced as they are on the live server:
//   - a game that walks on air, or paces to and fro on a spot, or leaps about, is sent back to the bot check
//     inside its first minute: told so, taken off as with the proper leave (its pass forgotten);
//   - a game that walks, runs and jumps about its first minute is left alone;
//   - a browser that names itself Chrome 141 is told plainly to update and is not let in, and with the switch off it is.
// The real server on a port of its own (bots.test.ts for how the bot check itself is reached). About ninety seconds.
//   npx tsx test/probation.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { F_GROUND, PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
const CHROME_141 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CHROME_155 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
let n = 0;

class Conn {
  ws!: WebSocket;
  got: S2C[] = [];
  closed = false;
  closedAt = 0;
  in = 0;
  constructor(public port: number, public name: string, public ip: string, public agent = CHROME_155, public key = `probation-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async hello(): Promise<'in' | 'refused' | 'no'> {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`, { headers: { 'x-forwarded-for': this.ip, 'user-agent': this.agent } });
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => ((this.closed = true), (this.closedAt = Date.now())));
    if (!(await new Promise<boolean>((done) => (this.ws.once('open', () => done(true)), this.ws.once('error', () => done(false)))))) return 'no';
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 100; k++) {
      if (this.got.some((m) => m.t === 'welcome')) return void (this.in = Date.now()), 'in';
      if (this.got.some((m) => m.t === 'kick')) return 'refused';
      await sleep(50);
    }
    return 'no';
  }
  why() {
    return (this.got.find((m) => m.t === 'kick') as { reason?: string } | undefined)?.reason ?? '';
  }
  /** plays `secs` seconds of a body that is at `at(t)` (x, height over the ground or `abs`, z, a turn of the head), fifteen tellings a second; stops when put off */
  async play(secs: number, at: (t: number) => { x: number; z: number; h?: number; abs?: number; yaw?: number }) {
    const t0 = Date.now();
    while (!this.closed && Date.now() - t0 < secs * 1000) {
      const t = (Date.now() - t0) / 1000, p = at(t), y = p.abs ?? ground(p.x, p.z) + (p.h ?? 0);
      if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 's', p: [p.x, y, p.z, p.yaw ?? 0, 0, (p.h ?? 0) < 0.05 ? F_GROUND : 0], w: null, m: [], n: Math.round(performance.now()) }));
      await sleep(66);
    }
  }
}

const dirs: string[] = [], servers: ChildProcess[] = [];
async function server(port: number, env: Record<string, string>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-probation-'));
  dirs.push(dir);
  // (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
  const s = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'enforce', BOTCHECK: 'off', RENDER: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(s);
  let logged = '';
  s.stdout!.on('data', (d) => (logged += d));
  s.stderr!.on('data', (d) => (logged += d));
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  return { log: () => logged };
}

let checks = 0, failed: unknown = null;
const ok = (what: string) => {
  checks++;
  console.log(`  ok  ${what}`);
};
try {
  const P = 8231;
  const s = await server(P, {});
  // (somewhere open, away from the buildings: a long walk east from the middle of the map's south)
  const X = 40, Z = 260;
  const sent = (c: Conn) => (c.closed && /bot check/i.test(c.why()) ? (c.closedAt - c.in) / 1000 : -1);

  // ---- bots: on air, pacing, leaping: all sent back inside the first minute, at once and side by side
  {
    const air = new Conn(P, 'Kestrel', '7.7.1.1'), pace = new Conn(P, 'Tarn', '7.7.1.2'), jitter = new Conn(P, 'Voss', '7.7.1.3'), leap = new Conn(P, 'Hyde', '7.7.1.4');
    for (const c of [air, pace, jitter, leap]) assert.equal(await c.hello(), 'in', `${c.name} was not let in: ${c.why()}`);
    const top = ground(X, Z) + 7;
    await Promise.all([
      // (a straight line at one height while the ground falls and rises under it)
      air.play(62, (t) => ({ x: X + t * 3, z: Z, abs: top })),
      pace.play(62, (t) => ({ x: X + 10 + Math.abs(((t * 4) % 10) - 5), z: Z + 10, yaw: Math.sin(t * 7) * 0.2 })),
      jitter.play(62, (t) => ({ x: X + 20 + Math.sin(t * 9) * 0.5, z: Z + 20 + Math.cos(t * 7) * 0.3, yaw: Math.sin(t * 5) * 0.4 })),
      // (five metres in a fifteenth of a second, there and back)
      leap.play(62, (t) => ({ x: X + 30 + (Math.floor(t * 15) % 2) * 5, z: Z + 30 })),
    ]);
    for (const c of [air, pace, jitter, leap]) {
      const at = sent(c);
      assert.ok(at > 0 && at <= 60, `${c.name} was not sent back to the bot check inside its first minute (${c.closed ? `put off: ${c.why()}` : 'still in'})\n${s.log().slice(-800)}`);
      console.log(`      ${(s.log().match(new RegExp(`${c.name} is sent back[^\\n]*`)) ?? [''])[0]}`);
    }
    ok('on air, pacing on a spot, jittering on a spot, leaping about: each sent back to the bot check inside its first minute');
  }

  // ---- a person's first minute: walks, runs, stops, jumps; left alone
  {
    const anna = new Conn(P, 'Anna', '7.7.2.1');
    assert.equal(await anna.hello(), 'in');
    await anna.play(65, (t) => {
      const u = t % 3, h = u < 0.7 ? Math.max(0, 4.8 * u - 6.9 * u * u) : 0;
      return { x: X - 60 + t * 2.5 + Math.sin(t / 4) * 5, z: Z - 40 + Math.sin(t / 9) * 12, h: t > 20 ? h : 0, yaw: t / 10 };
    });
    assert.ok(!anna.closed, `somebody walking, running and jumping about their first minute was put off: ${anna.why()}`);
    ok('a person walking, running and jumping about their first minute is left alone');
  }

  // ---- Chrome 141: told to update, not let in
  {
    const old = new Conn(P, 'Old', '7.7.3.1', CHROME_141);
    assert.equal(await old.hello(), 'refused');
    assert.match(old.why(), /out of date/i);
    assert.match(s.log(), /Old is not let in: .*Chrome 141/);
    ok('a browser that names itself Chrome 141 is told to update it, and not let in');
  }
  const off = await server(P + 1, { REFUSE_AGENTS: 'off' });
  {
    const old = new Conn(P + 1, 'Old', '7.7.3.2', CHROME_141);
    assert.equal(await old.hello(), 'in', `with the switch off, Chrome 141 was refused: ${old.why()}\n${off.log().slice(-400)}`);
    ok('with REFUSE_AGENTS=off, Chrome 141 is let in');
  }
} catch (e) {
  failed = e;
} finally {
  for (const s of servers) s.kill();
  await sleep(300);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
if (failed) throw failed;
console.log(`\n${checks} checks passed`);
