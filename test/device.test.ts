// The device a game runs on (server/device.ts, src/net/device.ts; 2026-10-16, after a swarm of a dozen names on one
// machine through fifteen rented addresses). What has to hold, at hello and before the bot check:
//   - a game that says nothing of its device, where one is needed (DEVICE_NEED), is told the game was updated;
//   - one player whose address changes as they play (a phone) is one game: in every time, from any number of addresses;
//   - a household: two games on one device play together; a third on it is turned away (DEVICE_LIVE), not kept
//     off, and is in once one of the two leaves;
//   - a farm: DEVICE_SPREAD games on one device from as many public addresses inside an hour, and the device is kept
//     off for a day: the third is turned away, the two in the world go out, a fourth from a fourth address is not
//     let in, and /healthz counts them;
//   - the rules themselves (cameWith, isFarm): three games at one address are no farm, nor games at private addresses.
// The real server on a port of its own, connections over the wire. About ten seconds.
//   npx tsx test/device.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { cameWith, forgetDevices, isFarm } from '../server/device';

const PORT = 8233;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;

class Conn {
  ws!: WebSocket;
  got: S2C[] = [];
  closed = false;
  constructor(public name: string, public ip: string, public fp: string, public key = `device-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async hello(): Promise<'in' | 'refused' | 'no'> {
    this.got = [];
    this.closed = false;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { 'x-forwarded-for': this.ip } });
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.closed = true));
    if (!(await new Promise<boolean>((done) => (this.ws.once('open', () => done(true)), this.ws.once('error', () => done(false)))))) return 'no';
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name, ...(this.fp ? { fp: this.fp } : {}) }));
    for (let k = 0; k < 100; k++) {
      if (this.got.some((m) => m.t === 'welcome')) return 'in';
      if (this.got.some((m) => m.t === 'kick')) return 'refused';
      await sleep(50);
    }
    return 'no';
  }
  why() {
    return (this.got.find((m) => m.t === 'kick') as { reason?: string } | undefined)?.reason ?? '';
  }
  leave() {
    this.ws.close();
  }
}
const healthz = async () => (await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json()) as { players: number; turned: { device: number } };

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-device-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', BOTCHECK: 'off', RENDER: '', DEVICE_NEED: 'on', PER_ADDRESS: '0', FRESH_S: '0.2' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let checks = 0, failed: unknown = null;
const ok = (what: string) => {
  checks++;
  console.log(`  ok  ${what}`);
};
const D1 = 'a1b2c3d4e5f60718293a', D2 = 'b2c3d4e5f60718293a4b', D3 = 'c3d4e5f60718293a4b5c';
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);

  // ---- the rules themselves
  forgetDevices();
  const t0 = 1_000_000;
  assert.ok(!isFarm(cameWith('d', 'k1', '203.0.113.1', true, t0)));
  assert.ok(!isFarm(cameWith('d', 'k2', '203.0.113.1', true, t0 + 1)));
  assert.ok(!isFarm(cameWith('d', 'k3', '203.0.113.1', true, t0 + 2)), 'three games at one address were called a farm');
  assert.ok(!isFarm(cameWith('d', 'k4', '192.168.1.9', false, t0 + 3)), 'a private address counted as a place');
  assert.ok(!isFarm(cameWith('d', 'k1', '203.0.113.2', true, t0 + 4)), 'one game moving address made a second place of it');
  const farm = cameWith('d', 'k5', '203.0.113.3', true, t0 + 5);
  assert.ok(isFarm(farm), `five games at three addresses are a farm: ${JSON.stringify(farm)}`);
  assert.ok(!isFarm(cameWith('d', 'k6', '203.0.113.4', true, t0 + 2 * 3600_000)), 'what was seen an hour ago still counted');
  ok('the rules: a household is no farm, nor private addresses, nor one game moving address; three games at three addresses are');

  // ---- no device said
  const mute = new Conn('Mute', '198.51.100.9', '');
  assert.equal(await mute.hello(), 'refused');
  assert.match(mute.why(), /updated/i, mute.why());
  ok('a game that says nothing of its device is told the game was updated');

  // ---- one player, three addresses
  const phone = new Conn('Phone', '198.51.100.21', D1);
  for (const ip of ['198.51.100.21', '198.51.100.22', '198.51.100.23']) {
    phone.ip = ip;
    assert.equal(await phone.hello(), 'in', `the phone was not let in from ${ip}: ${phone.why()}\n${logged.slice(-400)}`);
    phone.leave();
    await sleep(150);
  }
  ok('one game from three addresses in a row is in every time');

  // ---- a household
  const pa = new Conn('Pa', '203.0.113.7', D2), ma = new Conn('Ma', '203.0.113.7', D2), kid = new Conn('Kid', '203.0.113.7', D2);
  assert.equal(await pa.hello(), 'in', pa.why());
  assert.equal(await ma.hello(), 'in', ma.why());
  assert.equal(await kid.hello(), 'refused');
  assert.match(kid.why(), /already 2 playing on this device/i, kid.why());
  assert.ok(!pa.closed && !ma.closed, 'the two playing were put out');
  ma.leave();
  await sleep(300);
  assert.equal(await kid.hello(), 'in', `the third was not let in once one had left: ${kid.why()}`);
  ok('two games play on one device; a third waits for one of them to leave, and is not kept off');

  // ---- a farm
  const b1 = new Conn('Merric635', '41.140.2.3', D3), b2 = new Conn('Brambl116', '181.123.4.5', D3), b3 = new Conn('Drayto518', '103.200.6.7', D3), b4 = new Conn('Norwoo429', '51.39.8.9', D3);
  assert.equal(await b1.hello(), 'in', b1.why());
  assert.equal(await b2.hello(), 'in', b2.why());
  assert.equal(await b3.hello(), 'refused');
  assert.match(b3.why(), /kept off this server for about 24 hours/i, b3.why());
  await sleep(300);
  assert.ok(b1.closed && b2.closed, 'the two of the farm in the world were not put out');
  assert.match(b1.why(), /kept off/i, b1.why());
  assert.equal(await b4.hello(), 'refused');
  assert.match(b4.why(), /kept off/i, b4.why());
  assert.match(logged, /\[device\] Drayto518 \(c3d4e5f6\) is kept off for 24 hours: 3 games on one device from 3 addresses inside an hour/);
  const h = await healthz();
  assert.ok(h.turned.device >= 5, `turned.device is ${h.turned.device}`);
  assert.equal(h.players, 2, `${h.players} playing: the household should be`);
  ok('three games on one device from three addresses: the device is kept off a day, its games put out, a fourth not let in, all counted');

  console.log(`\nall ${checks} checks passed`);
} catch (e) {
  failed = e;
  console.error('\nFAILED:', e);
  console.error('\nserver log (tail):\n' + logged.slice(-3000));
} finally {
  server.kill();
  await sleep(300);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* windows holds the file a moment */
  }
  process.exit(failed ? 1 : 0);
}
