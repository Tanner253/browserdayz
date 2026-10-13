// A life kept by the server (server/index.ts, under that heading): somebody whose game is not answering can be
// killed all the same; a connection that goes without a proper leave leaves its body behind, to be killed and
// searched, and whoever comes back in time is back in it; the proper leave is waited out, standing still.
// The real server on a port of its own, with short times, and players over the wire. About fifty seconds.
//   npx tsx test/away.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8147, LINGER = 5, LOGOUT = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  constructor(public name: string, public key = `away-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
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
  carry(slots: Record<string, object>, health = 100) {
    this.send({ t: 'me', inv: { slots, active: null, containers: [] }, vitals: { health, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
  last<T extends S2C['t']>(t: T) {
    return this.got.filter((m) => m.t === t).pop() as Extract<S2C, { t: T }> | undefined;
  }
  /** was this one said dead, to this player */
  sawDie(who: Player) {
    return this.got.find((m) => m.t === 'death' && m.k.id === who.id) as Extract<S2C, { t: 'death' }> | undefined;
  }
  sawLeave(id: number) {
    return this.got.some((m) => m.t === 'leave' && m.id === id);
  }
}
const healthz = async () => (await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json()) as { players: number; asleep: number };

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-away-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: String(LINGER), LOGOUT_S: String(LOGOUT),
    // (a body is left only by somebody who has been in the world a while: a minute on the host, a fifth of a second here)
    FRESH_S: '0.2',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let checks = 0, failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);

  const gil = new Player('Gil');
  assert.ok(await gil.join());
  /** Gil shoots at somebody until the server says they are dead, or he has fired enough to kill three */
  const shoot = async (whom: Player, w = 'mosin', most = 8) => {
    gil.say(20, 0, w);
    await sleep(200);
    for (let k = 0; k < most && !gil.sawDie(whom); k++) {
      gil.send({ t: 'hit', to: whom.id, w, zone: 'torso' });
      await sleep(900);
    }
    return gil.sawDie(whom);
  };

  // ---- a game that is not answering: its player dies of what hits them; one that is answering says so itself
  const hal = new Player('Hal'), ivy = new Player('Ivy');
  for (const p of [hal, ivy]) assert.ok(await p.join());
  hal.say(50, 0);
  ivy.say(50, 4);
  hal.carry({}, 100);
  ivy.carry({}, 100);
  const here = setInterval(() => hal.say(50, 0), 300);
  // (Ivy says no more: her tab is behind another)
  await sleep(2200);
  const died = await shoot(ivy);
  assert.ok(died, `somebody whose game was not answering could not be killed:\n${logged.slice(-500)}`);
  assert.equal(died.k.by, gil.id, 'whoever killed them was not said to have');
  assert.ok(ivy.sawDie(ivy), 'whoever was killed while away was not told');
  const said = gil.got.filter((m) => m.t === 'hitok').length;
  assert.ok(said >= 1, 'the hits were not said to have landed');
  for (let k = 0; k < 4; k++) {
    gil.send({ t: 'hit', to: hal.id, w: 'mosin', zone: 'torso' });
    await sleep(900);
  }
  clearInterval(here);
  assert.ok(!gil.sawDie(hal), 'somebody whose game was answering was said dead by the server (their own game says so; the checks only watch)');
  checks++;
  console.log('  ok  somebody whose game is not answering dies of what hits them; somebody whose game is answering is left to it');

  // ---- heard from again, a game is told what its player has left
  const jon = new Player('Jon');
  assert.ok(await jon.join());
  jon.say(50, 8);
  jon.carry({}, 100);
  await sleep(2200);
  gil.say(20, 0, 'm9');
  await sleep(200);
  gil.send({ t: 'hit', to: jon.id, w: 'm9', zone: 'legs' });
  await sleep(500);
  assert.ok(!jon.last('hp'), 'a figure was sent to a game that had not been heard from');
  jon.say(50, 8);
  await sleep(400);
  const hp = jon.last('hp');
  assert.ok(hp && hp.health > 0 && hp.health < 100, `a game heard from again was not told what its player has left: ${JSON.stringify(hp)}`);
  // (and it cannot say it has more)
  jon.carry({}, 100);
  checks++;
  console.log(`  ok  a game heard from again is told the figure the server kept (${hp.health.toFixed(0)} of 100)`);

  // ---- a connection that goes without a proper leave leaves its body: seen, killed, searched
  const kay = new Player('Kay');
  assert.ok(await kay.join());
  kay.say(50, 12);
  kay.carry({ primary: { uid: 'away-test-rifle', id: 'ak', qty: 1, loaded: 0, mag: null } }, 100);
  await sleep(400);
  kay.ws.close();
  await sleep(900);
  assert.ok(!gil.sawLeave(kay.id), 'a body left behind was taken out of the world at once');
  const seen = gil.last('ps')?.s.find((r) => r[0] === kay.id);
  assert.ok(seen, 'a body left behind is not shown to anybody');
  assert.equal((await healthz()).asleep, 1, 'a body left behind is not counted as one');
  const dead = await shoot(kay);
  assert.ok(dead, 'a body left behind could not be killed');
  assert.ok(dead.corpse, 'a body left behind, killed, left nothing to search');
  await sleep(3600);
  assert.ok(gil.sawLeave(kay.id), 'a body left behind and killed was never taken out of the world');
  checks++;
  console.log('  ok  a connection gone without a proper leave leaves its body: shown, killed, and what it carried on it');

  // ---- back in time, they are back in it; left alone, it goes when its time is up
  const len = new Player('Len'), mia = new Player('Mia');
  for (const p of [len, mia]) assert.ok(await p.join());
  len.say(60, 0);
  len.carry({}, 77);
  mia.say(60, 6);
  await sleep(400);
  const was = len.id;
  len.ws.close();
  mia.ws.close();
  await sleep(1000);
  assert.ok(await len.join(), 'somebody who came back to their body was not let in');
  const back = len.last('welcome')!;
  assert.ok(Math.hypot(back.spawn.x - 60, back.spawn.z) < 1 && back.me?.vitals.health === 77, `somebody back in time is not where and how they were: ${JSON.stringify(back.spawn)} ${JSON.stringify(back.me?.vitals)}`);
  assert.ok(gil.sawLeave(was), 'the body they left was not taken out as they came back into it');
  assert.ok(!gil.sawLeave(mia.id), 'a body was taken out before its time');
  await sleep(LINGER * 1000 + 600);
  assert.ok(gil.sawLeave(mia.id), 'a body left behind was still there after its time');
  assert.equal((await healthz()).asleep, 0);
  checks++;
  console.log('  ok  whoever comes back in time is back in their body, as they were; a body left alone goes when its time is up');

  // ---- the proper leave: waited out, standing still; then the body goes with them
  const moe = new Player('Moe');
  assert.ok(await moe.join());
  moe.say(70, 0);
  await sleep(200);
  moe.send({ t: 'logout' });
  await sleep(300);
  assert.equal(moe.last('logout')?.left, LOGOUT);
  moe.say(73, 0);
  await sleep(300);
  assert.ok(moe.last('logout')?.left === 0 && /moved/.test(moe.last('logout')?.why ?? ''), 'a wait to leave was not called off by walking away');
  moe.send({ t: 'logout' });
  await sleep(200);
  gil.say(20, 0, 'm9');
  await sleep(200);
  gil.send({ t: 'hit', to: moe.id, w: 'm9', zone: 'legs' });
  await sleep(300);
  assert.ok(/hit/.test(moe.last('logout')?.why ?? ''), 'a wait to leave was not called off by being hit');
  moe.send({ t: 'logout' });
  for (let k = 0; k < (LOGOUT * 1000 + 1500) / 300 && !moe.shut; k++) {
    moe.say(73, 0);
    await sleep(300);
  }
  const bye = (moe.got.find((m) => m.t === 'kick') as { reason: string } | undefined)?.reason ?? '';
  assert.match(bye, /logged out/, `the wait over, nobody was let go:\n${logged.slice(-400)}`);
  await sleep(300);
  assert.ok(gil.sawLeave(moe.id), 'somebody who left the proper way is still in the world');
  assert.equal((await healthz()).asleep, 0, 'somebody who left the proper way left a body behind');
  checks++;
  console.log('  ok  the proper leave is called off by walking away or being hit; waited out, the body goes with its player');
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
