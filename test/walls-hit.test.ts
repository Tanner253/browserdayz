// A round through the map's own walls, on a server of its own (server/walls.ts, 'hit' in server/handle.ts): a
// shooter outside a building and a target inside it, where every line the server traces meets a wall, is refused and
// flagged; the same shots at the target in the open land. Never the live server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';
import { readWalls, roundClear } from '../server/walls';
import type { Vec3 } from '../src/sim/grenades';

const PORT = 8409;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
assert.equal(await readWalls(gunzipSync(readFileSync('server/solids.bin.gz')), null), '');

// ---- where: as the server judges (server/solid.ts `walled`), every line from the eye and a lean to either side, to
// the torso and a hand round it, meets a wall; and the ground is under every one of them
function blocked(s: Vec3, t: Vec3) {
  const eye: Vec3 = [s[0], s[1] + 1.6, s[2]], at: Vec3 = [t[0], t[1] + 1.25, t[2]];
  const dx = at[0] - eye[0], dz = at[2] - eye[2], l = Math.hypot(dx, dz), sx = -dz / l, sz = dx / l;
  const eyes: Vec3[] = [eye, [eye[0] + sx * 0.4, eye[1], eye[2] + sz * 0.4], [eye[0] - sx * 0.4, eye[1], eye[2] - sz * 0.4]];
  const aims: Vec3[] = [at, [at[0] + sx * 0.3, at[1], at[2] + sz * 0.3], [at[0] - sx * 0.3, at[1], at[2] - sz * 0.3], [at[0], at[1] + 0.3, at[2]], [at[0], at[1] - 0.3, at[2]]];
  return eyes.every((e) => aims.every((a) => !roundClear(e, a)));
}
const overGround = (a: Vec3, b: Vec3) => {
  for (let k = 1; k < 20; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / 20, z = a[2] + ((b[2] - a[2]) * k) / 20, y = a[1] + 1.4 + ((b[1] - a[1]) * k) / 20;
    if (ground(x, z) > y - 0.5) return false;
  }
  return true;
};
let pair: { s: Vec3; t: Vec3 } | null = null;
for (const b of world.buildings) {
  if (pair) break;
  for (let k = 0; k < 8 && !pair; k++) {
    const a = (k / 8) * Math.PI * 2, sx = b.x + Math.cos(a) * 30, sz = b.z + Math.sin(a) * 30;
    const s: Vec3 = [sx, ground(sx, sz), sz], t: Vec3 = [b.x, ground(b.x, b.z), b.z];
    if (overGround(s, t) && blocked(s, t)) pair = { s, t };
  }
}
assert.ok(pair, 'no building found with a wall on every line');
const { s, t } = pair;
// (and in the open: three metres to the shooter's side, every line clear)
const open: Vec3 = [s[0] + 3, ground(s[0] + 3, s[2]), s[2]];
console.log(`  shooter at ${s.map((v) => v.toFixed(1))}, target at ${t.map((v) => v.toFixed(1))} (inside), then ${open.map((v) => v.toFixed(1))} (open)`);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  constructor(public name: string, public key = `walls-hit-key-${name}-${String(++n).padStart(20, '0')}`) {}
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
  at(p: Vec3, w: string | null = null) {
    this.send({ t: 's', p: [p[0], p[1], p[2], 0, 0, 0], w, m: [] });
  }
  /** how many rounds of this player's the server dealt (said to them as 'hitok') */
  landed() {
    return this.got.filter((m) => m.t === 'hitok').length;
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-walls-hit-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LOCAL_ADMIN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let failed: unknown = null;
try {
  for (let k = 0; k < 900 && !(logged.includes('listening') && logged.includes('[walls]')); k++) await sleep(100);
  assert.match(logged, /\[walls\] \d+ pieces/, `the server has no walls:\n${logged.slice(-600)}`);

  const gil = new Player('Gil'), tom = new Player('Tom');
  for (const p of [gil, tom]) assert.ok(await p.join());
  tom.send({ t: 'me', inv: { slots: {}, active: null, containers: [] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  let tomAt = t;
  const keep = setInterval(() => {
    gil.at(s, 'mosin');
    tom.at(tomAt);
  }, 250);
  await sleep(1500);
  /** rounds fired at Tom, a second apart: @returns how many the server dealt */
  const shoot = async (most: number) => {
    const was = gil.landed();
    for (let k = 0; k < most; k++) {
      gil.send({ t: 'hit', to: tom.id, w: 'mosin', zone: 'torso' });
      await sleep(900);
    }
    return gil.landed() - was;
  };

  // (and behind the walls, Tom's place is not sent to Gil at all: server/sight.ts)
  const told = () => (gil.got.filter((m) => m.t === 'ps').pop() as Extract<S2C, { t: 'ps' }> | undefined)?.s.some((r) => r[0] === tom.id);
  assert.equal(told(), false, 'a player behind walls was sent');
  console.log('  ok  behind the walls, his place is not sent');
  assert.equal(await shoot(5), 0, `rounds through a wall were dealt:\n${logged.slice(-800)}`);
  assert.match(logged, /Gil shot Tom through a wall/, 'the shots through the wall were not flagged');
  console.log('  ok  five rounds through a wall: none dealt, flagged');

  tomAt = open;
  await sleep(1200);
  assert.equal(told(), true, 'a player in the open was not sent');
  assert.equal(await shoot(3), 3, `rounds in the open were not all dealt:\n${logged.slice(-800)}`);
  console.log('  ok  the same rounds in the open land, all three');
  clearInterval(keep);
} catch (e) {
  failed = e;
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
if (failed) throw failed;
console.log('walls-hit ok');
process.exit(0);
