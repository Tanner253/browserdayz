// The rest of the way down on the real server (server/sites.ts): what is turned at Bolotnaya, the time running out on it, the red pass and the
// goods lift, the jerrycan and the plant on Level 2, and the door to the train. A port of its own.   npx tsx test/sites-way.test.ts
import { DOOR } from '../src/sim/train-line';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { levelY } from '../src/sim/bunker';
import { makeItem } from '../src/sim/items';
import { GATES, RIDES, SITES, sitePoint, siteSpot, spotAt } from '../src/sim/sites';

const PORT = 8423, PAD = 35.6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VITALS = { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false, blood: 5000, bleed: 0 };
const P = { x: -1450, y: PAD, z: -320, rot: -1.0458 };

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.send({ t: 'hello', v: PROTOCOL, key: `way-${this.name}`.padEnd(40, '0'), name: this.name });
    for (let k = 0; k < 300 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    assert.ok(this.got.some((m) => m.t === 'welcome'), `${this.name} was not let in`);
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  at(x: number, y: number, z: number) { this.send({ t: 's', p: [x, y, z, 0, 0, 1], w: null, m: [] }); }
  async go(x: number, y: number, z: number) {
    this.at(x, y, z);
    await sleep(160);
  }
  carry(...ids: string[]) {
    const items = ids.map((id, k) => ({ ...makeItem(id, 1), x: k * 3, y: 0, rot: false }));
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'pockets', w: 20, h: 20, items }] }, vitals: VITALS });
  }
  all<T extends S2C['t']>(t: T) { return this.got.filter((m) => m.t === t) as Extract<S2C, { t: T }>[]; }
  site(s: string) { return this.all('site').filter((m) => m.s === s).pop(); }
  async until(what: string, f: () => boolean, ms = 6000) {
    for (let k = 0; k < ms / 40 && !f(); k++) await sleep(40);
    assert.ok(f(), what);
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-way-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, BOTCHECK: 'off', CHECKS: 'off', INFECTED: 'off', FRESH_S: '0.001', SITE_HOLD_S: '5', SITE_AGAIN_S: '2', SITE_GATE_S: '30', SITE_FUEL_S: '2' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let n = 0, failed: unknown = null;
const ok = (name: string) => {
  n++;
  console.log(`  ok  ${name}`);
};
try {
  for (let k = 0; k < 1800 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), 'the server did not start');
  const ann = new Player('Ann');
  await ann.join();
  const bol = SITES.bolotnaya, reader = sitePoint(bol, bol.reader);

  // ---- the time runs out with something still to turn
  await ann.go(reader[0], 18, reader[1]);
  ann.carry('card_yellow');
  await sleep(200);
  ann.send({ t: 'site', s: 'bolotnaya' });
  await ann.until('the alarm went', () => ann.site('bolotnaya')?.phase === 'alarm');
  assert.equal(ann.all('door').filter((m) => m.open).length, 0, 'the room stays shut until the last is turned');
  const [vx, vz] = sitePoint(bol, bol.steps!.at[0]);
  await ann.go(vx, 18, vz);
  ann.send({ t: 'sitestep', s: 'bolotnaya', k: 0 });
  await ann.until('one is told done', () => ann.site('bolotnaya')?.done?.length === 1);
  ann.send({ t: 'sitestep', s: 'bolotnaya', k: 1 });
  await sleep(250);
  assert.equal(ann.site('bolotnaya')?.done?.length, 1, 'a valve from where nobody stands');
  await ann.until('the time ran out', () => ann.site('bolotnaya')?.phase === 'spent', 8000);
  assert.equal(ann.all('drop+').filter((m) => m.d.site?.includes('locker')).length, 0, 'a locker for nothing');
  ok('turned from where they stand, one at a time; the room shut until the last; and time up gives nothing');

  // ---- and turned in time
  await ann.until('it came back', () => ann.site('bolotnaya')?.phase === 'idle', 6000);
  await ann.go(reader[0], 18, reader[1]);
  ann.carry('card_yellow');
  await sleep(200);
  ann.send({ t: 'site', s: 'bolotnaya' });
  await ann.until('the alarm went again', () => ann.site('bolotnaya')?.phase === 'alarm');
  for (let k = 0; k < 3; k++) {
    const [x, z] = sitePoint(bol, bol.steps!.at[k]);
    await ann.go(x, 18, z);
    ann.send({ t: 'sitestep', s: 'bolotnaya', k });
    await ann.until(`valve ${k}`, () => ann.site('bolotnaya')?.done?.length === k + 1);
  }
  await ann.until('the room opened', () => ann.all('door').some((m) => m.open));
  await ann.until('the locker stood', () => ann.all('drop+').some((m) => m.d.site?.includes('locker')));
  const locker = ann.all('drop+').find((m) => m.d.site?.includes('locker'))!.d;
  await ann.go(locker.x, locker.y, locker.z);
  ann.send({ t: 'copen', cid: locker.uid });
  await ann.until('the locker opened', () => ann.all('cdata').some((m) => m.cid === locker.uid));
  assert.ok(ann.all('cdata').find((m) => m.cid === locker.uid)!.items.some((i) => i.id === 'card_red'));
  ok('all three turned in time: the room opens and the locker holds the red pass');

  // ---- the lift
  const [gx, gy, gz] = spotAt(GATES.lift.at, P);
  await ann.go(gx, gy!, gz);
  ann.send({ t: 'ride', w: 'lift_down' });
  await sleep(250);
  assert.equal(ann.all('put').length, 0, 'the lift ran with its door shut');
  ann.carry('bandage');
  await sleep(200);
  ann.send({ t: 'gate', g: 'lift' });
  await sleep(250);
  assert.equal(ann.all('gate').filter((m) => m.g === 'lift' && m.open).length, 0, 'the door opened for no pass');
  ann.carry('card_red');
  await sleep(200);
  ann.send({ t: 'gate', g: 'lift' });
  await ann.until('the door opened', () => ann.all('gate').some((m) => m.g === 'lift' && m.open));
  await ann.until('the pass was cancelled', () => ann.all('siteok').some((m) => m.card === 'card_red'));
  const [cx, cy, cz] = spotAt(RIDES.lift_down.from, P);
  await ann.go(cx, cy!, cz);
  ann.send({ t: 'ride', w: 'lift_down' });
  await ann.until('the lift ran', () => ann.all('put').length === 1);
  const put = ann.all('put')[0], [tx, ty, tz] = spotAt(RIDES.lift_down.to, P);
  assert.ok(Math.hypot(put.x - tx, put.z - tz) < 0.1 && Math.abs((put.y ?? 0) - ty!) < 0.1, 'the lift went somewhere else');
  ok('the red pass opens the far door and the lift then goes to Level 2');

  // ---- the plant
  const L2 = SITES.level2, Y2 = PAD + levelY(2), plant = siteSpot(L2, L2.reader), [px, , pz] = spotAt(plant, P);
  await ann.go(px, Y2, pz);
  ann.carry('bandage');
  await sleep(200);
  ann.send({ t: 'site', s: 'level2' });
  await sleep(250);
  assert.equal(ann.site('level2')?.phase, 'idle', 'the plant ran dry');
  const [fx, , fz] = spotAt(siteSpot(L2, L2.fuel!.at), P);
  await ann.go(fx, Y2, fz);
  ann.send({ t: 'sitefuel', s: 'level2' });
  await ann.until('the can was handed over', () => ann.all('kit').some((m) => m.items.some((i) => i.id === 'jerrycan')));
  await ann.until('the can is gone from the floor', () => ann.site('level2')?.fuel === false);
  ann.send({ t: 'sitefuel', s: 'level2' });
  await sleep(250);
  assert.equal(ann.all('kit').filter((m) => m.items.some((i) => i.id === 'jerrycan')).length, 1, 'two cans at once');
  await ann.until('the can came back', () => ann.site('level2')?.fuel === true, 6000);
  ok('a jerrycan lies on the floor, and is back in its time after it is taken');
  await ann.go(px, Y2, pz);
  ann.carry('jerrycan');
  await sleep(200);
  ann.send({ t: 'site', s: 'level2' });
  await ann.until('the plant ran', () => ann.site('level2')?.phase === 'alarm');
  await ann.until('the plant ran out, and its locker opened', () => ann.all('drop+').filter((m) => m.d.site?.includes('Level 2')).length >= 2, 9000);
  ok('fed, the plant runs and Level 2 gives up its black pass');

  // ---- the door to the train, at the foot of the Kupol's stair
  const [rx, ry, rz] = DOOR.reader;
  await ann.go(rx, ry + 0.1, rz);
  ann.send({ t: 'gate', g: 'train' });
  await sleep(250);
  assert.ok(!ann.all('gate').some((m) => m.g === 'train' && m.open), 'the door opened with no pass');
  ann.carry('card_purple');
  await sleep(200);
  ann.send({ t: 'gate', g: 'train' });
  await ann.until('the door opened', () => ann.all('gate').some((m) => m.g === 'train' && m.open));
  ok('only the purple pass opens the door to the train');

  // ---- the vault, which wants no pass: only somebody at its breaker, on its own level
  const V = SITES.vault, Y3 = PAD + levelY(3), [bx, , bz] = spotAt(siteSpot(V, V.reader), P);
  await ann.go(bx, Y3 + 3.8, bz);
  ann.carry('bandage');
  await sleep(200);
  ann.send({ t: 'site', s: 'vault' });
  await sleep(250);
  assert.equal(ann.site('vault')?.phase, 'idle', 'the breaker was thrown from the level above');
  await ann.go(bx, Y3, bz);
  ann.send({ t: 'site', s: 'vault' });
  await ann.until('the vault went off', () => ann.site('vault')?.phase === 'alarm');
  await ann.until('the vault paid out', () => ann.all('drop+').some((m) => m.d.site?.includes('locker at the vault')), 9000);
  const vault = ann.all('drop+').find((m) => m.d.site?.includes('locker at the vault'))!.d;
  await ann.go(vault.x, vault.y, vault.z);
  ann.send({ t: 'copen', cid: vault.uid });
  await ann.until('the vault\'s locker opened', () => ann.all('cdata').some((m) => m.cid === vault.uid));
  assert.ok(ann.all('cdata').find((m) => m.cid === vault.uid)!.items.some((i) => i.id === 'night_vision'), 'no night vision in the vault');
  ok('the vault wants a hand at its breaker on its own level, and pays out night vision');

  // ---- out by the ladder, and the mine's gates
  const [lx, ly, lz] = spotAt(RIDES.ladder.from, P), before = ann.all('put').length;
  await ann.go(lx, ly!, lz);
  ann.send({ t: 'ride', w: 'ladder' });
  await ann.until('the ladder went up', () => ann.all('put').length === before + 1);
  const up = ann.all('put').pop()!, [ux, , uz] = spotAt(RIDES.ladder.to, P);
  assert.ok(Math.hypot(up.x - ux, up.z - uz) < 0.1 && up.y === undefined, 'the ladder does not come up on the ground at the camp');
  ok('the ladder comes up at the camp over the bunker');

  const [wx, , wz] = spotAt(GATES.mine.at, P), [ex, , ez] = spotAt(GATES.mine.also!, P), [ix, iy, iz] = spotAt(RIDES.mine_in.to, P);
  await ann.go(wx, 2, wz);
  ann.send({ t: 'ride', w: 'mine_in' });
  await sleep(250);
  assert.equal(ann.all('put').length, before + 1, 'the mine let somebody in with its gate shut');
  ann.carry('card_yellow');
  await sleep(200);
  ann.send({ t: 'gate', g: 'mine' });
  await ann.until('the mine opened', () => ann.all('gate').some((m) => m.g === 'mine' && m.open));
  assert.equal(ann.all('siteok').filter((m) => m.card === 'card_yellow').length, 2, 'the mine took the yellow pass');
  const [mx, , mz] = spotAt(RIDES.mine_in.from, P);
  await ann.go(mx, 2, mz);
  ann.send({ t: 'ride', w: 'mine_in' });
  await ann.until('in by the west gate', () => ann.all('put').length === before + 2);
  const inside = ann.all('put').pop()!;
  assert.ok(Math.hypot(inside.x - ix, inside.z - iz) < 0.1 && Math.abs(inside.y! - iy!) < 0.1, 'the gate leads somewhere else');
  await ann.go(ix + 1, iy!, iz);
  ann.send({ t: 'ride', w: 'mine_out' });
  await ann.until('out again', () => ann.all('put').length === before + 3);
  assert.ok(Math.hypot(ann.all('put').pop()!.x - wx, ann.all('put').pop()!.z - wz) < 6, 'out by another gate');
  assert.ok(ex !== wx && ez !== wz);
  ok('the yellow pass opens the mine and stays with whoever showed it, and there is a way out from inside');
} catch (e) {
  failed = e;
}
server.kill();
await sleep(200);
try { rmSync(dir, { recursive: true, force: true }); } catch { /* (the server may still hold it) */ }
if (failed) {
  console.log(logged.slice(-1000));
  throw failed;
}
console.log(`the way down: ${n} passed`);
process.exit(0);
