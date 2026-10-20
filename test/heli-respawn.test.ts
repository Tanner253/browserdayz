// The helicopter's pad by the fort on the real server (HELI.respawn, the due loop in server/index.ts): a new one stands
// there only once no helicopter of the pad is left on the map, its time served, and the pad then stood clear a while.
// The owner, 2026-10-19: "the heli by the castle isntantly resspawned on live server when someone got in and flew the
// first one away a 2nd one respawned too fast". An admin's helicopter, booked to the pad, burned while the pad's own
// stood on it: a new one was due, waited under the one parked there, and stood the moment that was flown off.
// The real server on a port of its own, with the times short (and LOCAL_ADMIN, for /spawn).
//   npx tsx test/heli-respawn.test.ts
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { HELI } from '../src/sim/heli';

const PORT = 8287, JEEP_RESPAWN = 2, RESPAWN = 5, HOLD = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Car = { i: number; k?: number; s: number[]; hp: number };

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `heli-respawn-${this.name}`.padEnd(40, '0'), name: this.name }));
    for (let k = 0; k < 300 && !this.welcome; k++) await sleep(50);
    assert.ok(this.welcome, `${this.name} was not let in`);
  }
  get welcome() { return this.got.find((m) => m.t === 'welcome') as unknown as { you: number; vehicles: Car[] } | undefined; }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  at(x: number, y: number, z: number) { this.send({ t: 's', p: [x, y, z, 0, 0, 1], w: null, m: [] }); }
  boomed(i: number) { return this.got.some((m) => m.t === 'vboom' && m.i === i); }
  /** a car stood since `from` (an index into what was heard), within a metre of x, z */
  stood(from: number, x: number, z: number) { return this.got.slice(from).find((m): m is Extract<S2C, { t: 'v+' }> => m.t === 'v+' && Math.hypot(m.v.s[0] - x, m.v.s[2] - z) < 1); }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-heli-respawn-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, BOTCHECK: 'off', CHECKS: 'off', LINGER_S: '0', LOCAL_ADMIN: '1', JEEP_RESPAWN_S: String(JEEP_RESPAWN), HELI_RESPAWN_S: String(RESPAWN), HELI_HOLD_S: String(HOLD) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let n = 0;
let failed: unknown = null;
const pass = (what: string) => { n++; console.log('  ok  ' + what); };
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), 'the server did not start');
  const a = new Player('Pilot');
  await a.join();
  const forts = a.welcome!.vehicles.filter((v) => v.k === HELI.kind && v.s[2] < 0);
  assert.equal(forts.length, 1, 'not one helicopter by the fort');
  const fort = forts[0], [px, py, pz] = fort.s;
  /** somewhere to stand well off the pad and off any wreck */
  const off = (dx: number, dz: number) => a.at(px + dx, py - 0.8, pz + dz);
  /** a helicopter stood on the pad since `from` */
  const padHeli = (from: number) => { const m = a.stood(from, px, pz); return m && m.v.k === HELI.kind ? m : undefined; };

  /** take the controls (seat 0) of a vehicle */
  const board = async (v: Car) => {
    a.at(v.s[0] + 1, v.s[1] - 0.8, v.s[2]);
    await sleep(300);
    a.send({ t: 'vin', i: v.i, seat: 0 });
    await sleep(300);
    const sat = [...a.got].reverse().find((m) => m.t === 'vseat' && m.i === v.i) as Extract<S2C, { t: 'vseat' }> | undefined;
    assert.ok(sat && sat.seats[0] === a.welcome!.you, `could not take the controls of ${v.i}`);
  };
  /** move it, as the game at its controls says, to x, z (at the height given), and hold it there still at the controls */
  const move = async (v: Car, x: number, y: number, z: number) => {
    const [x0, y0, z0, qx, qy, qz, qw] = v.s;
    for (let k = 1; k <= 6; k++) { a.send({ t: 'v', i: v.i, s: [x0 + ((x - x0) * k) / 6, y0 + ((y - y0) * k) / 6, z0 + ((z - z0) * k) / 6, qx, qy, qz, qw, 0, 0, 0, 0, 0.6], at: Date.now() }); await sleep(60); }
    v.s = [x, y, z, qx, qy, qz, qw, 0, 0, 0, 0, 0];
    a.send({ t: 'vrest', i: v.i, s: v.s });
    await sleep(150);
  };
  /** out of it, well away, and it wrecked by knocks its game reports (too soft to hurt anybody, had anybody been in it): when it went up */
  const wreck = async (v: Car, dx: number, dz: number) => {
    a.send({ t: 'vout' });
    await sleep(200);
    a.at(v.s[0] + dx, v.s[1] - 0.8, v.s[2] + dz);
    await sleep(200);
    for (let k = 0; k < 20 && !a.boomed(v.i); k++) { a.send({ t: 'vcrash', i: v.i, n: 8 }); await sleep(60); }
    assert.ok(a.boomed(v.i), `${v.i} did not go up`);
    return Date.now();
  };

  // The case seen on live: an admin's helicopter by the fort (booked to the pad, the nearest of its kind) burns while
  // the pad's own stands on it; the pad's own is flown away: no second one on the pad, then or after.
  {
    off(40, 6);
    await sleep(300);
    let heard = a.got.length, mine: Extract<S2C, { t: 'v+' }> | undefined;
    a.send({ t: 'chat', text: `/spawn heli 1 ${(px + 40).toFixed(1)} ${pz.toFixed(1)}` });
    for (let k = 0; k < 30 && !(mine = a.got.slice(heard).find((m): m is Extract<S2C, { t: 'v+' }> => m.t === 'v+')); k++) await sleep(100);
    assert.ok(mine && mine.v.k === HELI.kind, 'the admin`s /spawn stood no helicopter');
    const admins = mine.v as Car;
    await board(admins);
    await wreck(admins, 60, 40);
    // (past when the jeep's rule would have stood a new one at the pad, with the pad's own still on it)
    await sleep((Math.max(JEEP_RESPAWN, RESPAWN) + 1) * 1000);
    heard = a.got.length;
    await board(fort);
    await move(fort, px - 300, py + 30, pz);
    off(-150, 60);
    for (let k = 0; k < (RESPAWN + HOLD + 3) * 10 && !padHeli(heard); k++) await sleep(100);
    assert.ok(!padHeli(heard), 'a second helicopter stood on the pad as the first was flown off');
    pass(`an admin's helicopter booked to the pad burned, the pad's own flown off: no new one on the pad in ${RESPAWN + HOLD + 3} s`);
  }

  // The pad's own wrecked away from it: a new one, but not before its time (HELI_RESPAWN_S, not the jeep's).
  {
    await board(fort);
    await move(fort, px - 300, py, pz);
    const heard = a.got.length;
    const boom = await wreck(fort, 150, 60);
    let fresh;
    for (let k = 0; k < (RESPAWN + 4) * 10 && !(fresh = padHeli(heard)); k++) await sleep(100);
    const after = (Date.now() - boom) / 1000;
    assert.ok(fresh, `no new helicopter on the pad ${RESPAWN + 4} s after its own burned`);
    assert.ok(after >= RESPAWN - 0.5, `a new one on the pad ${after.toFixed(1)} s after its own burned: before its time (${RESPAWN} s)`);
    assert.ok(fresh.v.hp > 0 && fresh.v.i !== fort.i, 'what was stood is not a new helicopter');
    fort.i = fresh.v.i;
    fort.s = fresh.v.s;
    pass(`the pad's own burned 300 m off: a new one on the pad ${after.toFixed(1)} s on (HELI_RESPAWN_S ${RESPAWN}, the jeep's ${JEEP_RESPAWN})`);
  }

  // Its new one due while something else stands on the pad (a jeep left on it): when that is driven off, the new one
  // comes only after the pad has stood clear HELI_HOLD_S, not that moment.
  {
    await board(fort);
    await move(fort, px - 300, py, pz);
    a.send({ t: 'vout' });
    await sleep(200);
    a.send({ t: 'vrest', i: fort.i, s: fort.s });
    let heard = a.got.length, jeep: Extract<S2C, { t: 'v+' }> | undefined;
    a.send({ t: 'chat', text: `/spawn jeep 1 ${(px + 2).toFixed(1)} ${pz.toFixed(1)}` });
    for (let k = 0; k < 30 && !(jeep = a.got.slice(heard).find((m): m is Extract<S2C, { t: 'v+' }> => m.t === 'v+')); k++) await sleep(100);
    assert.ok(jeep && !jeep.v.k, 'the admin`s /spawn stood no jeep');
    await board(fort);
    heard = a.got.length;
    await wreck(fort, 150, 60);
    await sleep((RESPAWN + 2) * 1000);
    assert.ok(!padHeli(heard), 'a new helicopter stood on the pad on top of the jeep');
    const car = jeep.v as Car;
    await board(car);
    await move(car, px - 50, car.s[1], pz + 40);
    a.send({ t: 'vout' });
    await sleep(100);
    a.send({ t: 'vrest', i: car.i, s: car.s });
    off(-120, 80);
    const clear = Date.now();
    await sleep((HOLD - 1) * 1000);
    assert.ok(!padHeli(heard), `a new helicopter on the pad ${((Date.now() - clear) / 1000).toFixed(1)} s after the jeep was driven off it: before the pad had stood clear ${HOLD} s`);
    let fresh;
    for (let k = 0; k < 50 && !(fresh = padHeli(heard)); k++) await sleep(100);
    assert.ok(fresh, `no new helicopter on the pad ${HOLD + 4} s after it stood clear`);
    pass(`its new one due under a jeep left on the pad: it stands ${((Date.now() - clear) / 1000).toFixed(1)} s after the jeep is driven off (HELI_HOLD_S ${HOLD}), not at once`);
  }
} catch (e) {
  failed = e;
} finally {
  if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error(failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log(`heli-respawn: ${n} passed`);
process.exit(0);
