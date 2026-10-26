// An admin's creative mode (the owner, 2026-10-25: "as admin i want to build and upgrade instantly and spawn anything i
// want"), on a server of its own (port 8396), everybody on it an admin (LOCAL_ADMIN) as on the local one:
//   - in creative, with nothing in the pockets but the plan and the hammer, a foundation is laid and nailed up to
//     armoured at once (no wait between the hammer's word and its blow), and no bench is asked for;
//   - somebody else on the server, not in creative, is refused for want of what it costs; and so is the admin once
//     creative is off. (The game can ask for creative only with /creative, which the server allows an admin alone.)
//   - an admin, creative off, throws a C4 (held back from players, an admin's: server/raid.ts): it sticks where its
//     thrower's game says and goes off (a short fuse here, CHARGE_FUSE), taking a C4's worth off the armoured foundation.
//   npx tsx test/creative.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import type { ItemInstance } from '../src/sim/items';
import { buildWorldData } from '../server/world';
import { Solids, noBuilding, wetAt } from '../src/sim/build/land';
import { Bases, heard, type Land } from '../src/sim/build/bases';
import { blocked, nearestSpot, spots, toWorld } from '../src/sim/build/snap';
import { BaseSolids } from '../src/sim/build/solid';
import { CHARGES } from '../src/sim/build/charges';
import { hpOf } from '../src/sim/build/pieces';

const PORT = 8396, SITE = 'http://127.0.0.1:9';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting a server');

// (two places out in the country a base may go, with room beside each)
const data = buildWorldData(process.cwd());
const solids = new Solids(data.trees, data.rocks);
const wet = wetAt(data.water, (x, z) => data.groundAt(x, z));
const land: Land = { ground: (x, z) => data.groundAt(x, z), why: (x, z) => noBuilding(x, z, data.places, data.buildings, data.spawns, wet), solids: (x, z, w) => solids.near(x, z, w) };
const sites: [number, number][] = [];
for (let x = -2400; x < 2400 && sites.length < 2; x += 37) for (let z = -1500; z < 1500 && sites.length < 2; z += 41) {
  if (sites.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 80)) continue;
  const bs = new Bases(land), r = bs.lay({ k: 'foundation', x, y: 0, z, r: 0, yaw: 0 }, 'me', 0);
  if (typeof r === 'string') continue;
  const b = r.base, sp = nearestSpot(spots(b, 'foundation'), 'foundation', { x: 3, y: 0, z: 0 }, 1);
  if (sp && !blocked(b, 'foundation', sp, bs.groundIn(b))) sites.push([x, z]);
}
assert.equal(sites.length, 2, 'no two places on the map a base may go');

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-creative-'));
let logged = '';
const server = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '0', LOCAL_ADMIN: '1', INFECTED: 'off', ANIMALS: 'off', STOP_BY_WORD: '1', CHARGE_FUSE: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  pockets: ItemInstance[] = [];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.send({ t: 'hello', v: PROTOCOL, key: `creative-test-key-${this.name}-`.padEnd(40, '0'), name: this.name, fp: `fp-${this.name}`.padEnd(64, 'c') });
    assert.ok(await this.until('welcome', () => true, 15000), `${this.name} was not let in`);
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async until<T extends S2C['t']>(t: T, test: (m: Extract<S2C, { t: T }>) => boolean = () => true, ms = 4000, from = 0) {
    for (let k = 0; k < ms / 25; k++) {
      const m = (this.got.slice(from).filter((q) => q.t === t) as Extract<S2C, { t: T }>[]).find(test);
      if (m) return m;
      await sleep(25);
    }
    return null;
  }
  say(text: string) {
    this.send({ t: 'chat', text });
  }
  async give(id: string) {
    const from = this.got.length;
    this.say(`/give ${id}`);
    const kit = await this.until('kit', () => true, 4000, from);
    assert.ok(kit?.items.length, `/give ${id} gave nothing`);
    this.pockets.push(...kit!.items);
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'gear', items: this.pockets.map((it, i) => ({ ...it, x: 0, y: i, rot: false })) }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false }, sp: 0 });
    return kit!.items[0];
  }
  async go([x, z]: [number, number], w: string) {
    const from = this.got.length;
    this.say(`/tp ${x.toFixed(2)} ${z.toFixed(2)}`);
    await this.until('put', () => true, 4000, from);
    this.send({ t: 's', p: [x, data.groundAt(x, z), z, 0, 0, 0], w, m: [] });
    await sleep(150);
  }
}

let ok = 0;
const pass = (s: string) => (ok++, console.log(`  ok  ${s}`));
try {
  for (let k = 0; k < 1500 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
  const a = new Player('Maker'), o = new Player('Other');
  await a.join();
  await o.join();
  const plan = await a.give('building_plan'), hammer = await a.give('hammer');
  await a.go(sites[0], 'building_plan');
  let from = a.got.length;
  a.say('/creative on');
  assert.ok(await a.until('powers', (m) => !!m.creative, 4000, from), 'creative was not put on');

  // ---- laid with nothing to lay it with, and nailed up to armoured at once
  from = a.got.length;
  a.send({ t: 'blay', k: 'foundation', x: sites[0][0], y: 0, z: sites[0][1], r: 0, yaw: 0, u: plan.uid });
  const told = await a.until('base', () => true, 4000, from);
  assert.ok(told, `the foundation was not laid: ${JSON.stringify(a.got.slice(from).filter((m) => m.t === 'tell'))}`);
  const base = heard(told!.b)!, piece = [...base.pieces.values()][0];
  pass('in creative, a foundation is laid with no planks or logs carried');
  a.send({ t: 's', p: [sites[0][0] + 1.5, data.groundAt(sites[0][0] + 1.5, sites[0][1]), sites[0][1], 0, 0, 0], w: 'hammer', m: [] });
  await sleep(150);
  from = a.got.length;
  a.send({ t: 'bup', b: base.id, p: piece.id, to: 4, go: 1, u: hammer.uid });
  a.send({ t: 'bup', b: base.id, p: piece.id, to: 4, go: 2, u: hammer.uid });
  const up = await a.until('bpc', (m) => m.b === base.id && m.p[0] === piece.id && m.p[2] === 4, 4000, from);
  assert.ok(up, `it was not nailed up: ${JSON.stringify(a.got.slice(from).filter((m) => m.t === 'tell' || m.t === 'bup'))}`);
  pass('and nailed up to armoured at once, no stone or plate carried and no workbench by');

  // ---- somebody not in creative pays, or is refused
  const theirs = await o.give('building_plan');
  await o.go(sites[1], 'building_plan');
  from = o.got.length;
  o.send({ t: 'blay', k: 'foundation', x: sites[1][0], y: 0, z: sites[1][1], r: 0, yaw: 0, u: theirs.uid });
  const no = await o.until('tell', (m) => /Needs/.test(m.text), 4000, from);
  assert.ok(no && !(await o.until('base', () => true, 300, from)), 'a player not in creative laid a foundation for nothing');
  pass('somebody not in creative is refused it for want of what it costs');

  // ---- and the admin, creative put off
  from = a.got.length;
  a.say('/creative off');
  assert.ok(await a.until('powers', (m) => !m.creative, 4000, from), 'creative was not put off');
  await a.go(sites[1], 'building_plan');
  from = a.got.length;
  a.send({ t: 'blay', k: 'foundation', x: sites[1][0], y: 0, z: sites[1][1], r: 0, yaw: 0, u: plan.uid });
  assert.ok(await a.until('tell', (m) => /Needs/.test(m.text), 4000, from), 'with creative off, the admin laid for nothing still');
  pass('and so is the admin, creative put off');

  // ---- a C4 thrown by the admin, creative off: stuck on the foundation's top, gone off, a C4's worth taken
  const c4 = await a.give('c4');
  await a.go(sites[0], 'c4');
  const s = new BaseSolids(() => [base]), down = s.first(toWorld(base, piece.x, piece.y + 3, piece.z), toWorld(base, piece.x, piece.y - 2, piece.z));
  assert.ok(down, 'no top found on the foundation');
  const top = toWorld(base, piece.x, piece.y + 3 - 5 * down!.t, piece.z);
  from = a.got.length;
  a.send({ t: 'bthrow', w: 'c4', u: c4.uid, o: [top[0], top[1] + 1.2, top[2]], v: [0, -1, 0] });
  const flying = await a.until('bcharge', (m) => !!m.v && m.w === 'c4', 4000, from);
  assert.ok(flying, `the admin's C4 was not thrown: ${JSON.stringify(a.got.slice(from).filter((m) => m.t === 'tell'))}`);
  a.send({ t: 'bstick', i: flying!.i, at: [top[0], top[1] + 0.04, top[2]], n: [0, 1, 0] });
  const hit = await a.until('bhp', (m) => m.b === base.id && m.hp.some(([id]) => id === piece.id), 6000, from);
  const full = hpOf(piece.k, 4);
  assert.ok(hit, 'the C4 did not go off on the foundation');
  assert.equal(hit!.hp.find(([id]) => id === piece.id)![1], Math.round(full - CHARGES.c4.dmg[4]), 'not a C4 the less');
  pass(`and an admin, creative off, throws a C4: stuck on the foundation and gone off, ${full} to ${full - CHARGES.c4.dmg[4]}`);
} finally {
  server.stdin!.write('stop\n');
  await sleep(1500);
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\nCREATIVE TEST PASSED (${ok})`);
process.exit(0);
