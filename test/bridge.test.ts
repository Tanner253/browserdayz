// The bridge on the loop road (src/sim/bridge.ts, LOOP in src/world/worldgen.ts): that its deck is something to
// stand on for everything that asks, and above all for the server, whose checks on where a player says they are
// are enforced on the live game. Somebody on a deck twenty metres over a cleft is far over the ground with
// nothing under them, to anything that knows only the ground: the server is to know better, and is to go on
// knowing that whoever stands in the cleft under the bridge is on the ground and not under it.
//
// The first part is sums. The second starts the real server, enforcing, on a port of its own, and plays players
// against it over the wire: one walks the bridge, sprints back and stands on it; one stands in the cleft under
// it; one drives a jeep to it, across it, stops on it and gets out; and one hangs in the air over open ground far
// from it, who is the only one of them written down. About a minute.   npx tsx test/bridge.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { BRIDGE, deckAt, deckWidth, onBridge, spanOf, standAt, type Bridge } from '../src/sim/bridge';
import { RIDE_HEIGHT, jeepSpots, yawQuat } from '../src/sim/vehicles';
import { LOOP, generateWorld, heightAt, inPlay, loopLine } from '../src/world/worldgen';
import { bridgeBoxes } from '../src/world/bridge';

const PORT = 8143;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const b = world.bridges[0];
/** a spot on the bridge: so far along it (0 to 1) and so far to the side of its middle (metres) */
const on = (t: number, side = 0): [number, number] => {
  const len = spanOf(b), ux = (b.bx - b.ax) / len, uz = (b.bz - b.az) / len;
  return [b.ax + ux * len * t - uz * side, b.az + uz * len * t + ux * side];
};

ok('there is one bridge: on the road, level, bank to bank, and nowhere more than 25 m over the ground', () => {
  assert.equal(world.bridges.length, 1);
  assert.ok(spanOf(b) > 55 && spanOf(b) < 80, `a bridge of ${spanOf(b).toFixed(0)} m`);
  assert.equal(b.ay, LOOP.deck);
  assert.equal(b.by, LOOP.deck);
  // the road comes to it and goes on from it: the line out of the town ends where it begins, and the line along the shelf begins where it ends
  const roads = world.roads.filter((r) => !r.side), over = roads.find((r) => r.bridge)!, k = roads.indexOf(over);
  assert.ok(over && over.points.length === 6, 'no line of the road for the bridge');
  const before = roads[k - 1].points, after = roads[k + 1].points, e = before.length - 3;
  assert.ok(Math.hypot(before[e] - b.ax, before[e + 2] - b.az) < 0.01 && Math.abs(before[e + 1] - b.ay) < 0.01, 'the road does not come to the bridge');
  assert.ok(Math.hypot(after[0] - b.bx, after[2] - b.bz) < 0.01 && Math.abs(after[1] - b.by) < 0.01, 'the road does not go on from the bridge');
  // the ground at its two ends is the road's bed, a hand under the deck; under its middle it is a cleft
  // (a pace and a half back from each end: further back the road is already climbing to the bridge, or falling from it)
  for (const [x, z] of [on(-1.5 / spanOf(b)), on(1 + 1.5 / spanOf(b))]) assert.ok(Math.abs(ground(x, z) - (LOOP.deck - 0.08)) < 0.35, `the ground at the bridge's end is ${(ground(x, z) - LOOP.deck).toFixed(2)} m off the deck`);
  let deep = 0;
  for (let t = 0; t <= 1; t += 0.02) for (const side of [-deckWidth() / 2, 0, deckWidth() / 2]) deep = Math.max(deep, LOOP.deck - ground(...on(t, side)));
  assert.ok(deep > 18 && deep <= 25, `the deck is ${deep.toFixed(1)} m over the ground at the most`);
  // and all of it is in the Zona
  for (let t = 0; t <= 1; t += 0.1) assert.ok(inPlay(...on(t)), 'the bridge is outside the Zona');
});

ok('what there is to stand on: the deck for whoever is on it, the ground for whoever is under it or beside it', () => {
  const [mx, mz] = on(0.5), g = ground(mx, mz);
  assert.equal(deckAt(world.bridges, mx, mz), LOOP.deck);
  // on the deck: standing, a jump over it, down on the belly
  for (const y of [LOOP.deck, LOOP.deck + 1.2, LOOP.deck + 0.02]) assert.equal(standAt(world.bridges, g, mx, y, mz), LOOP.deck);
  // on the footway, a kerb higher
  const [fx, fz] = on(0.5, BRIDGE.road / 2 + 0.5);
  assert.equal(standAt(world.bridges, ground(fx, fz), fx, LOOP.deck + BRIDGE.kerb, fz), LOOP.deck + BRIDGE.kerb);
  // in the cleft under it: on the ground, standing or jumping, and still so as high as a body can get without being on the deck
  for (const y of [g, g + 1.5, g + 6, LOOP.deck - BRIDGE.under - 0.1]) assert.equal(standAt(world.bridges, g, mx, y, mz), g);
  // beside it, over the cleft with nothing under: the ground (and so somebody hanging there is in the air)
  const [sx, sz] = on(0.5, deckWidth() / 2 + 2);
  assert.equal(deckAt(world.bridges, sx, sz), null);
  assert.equal(standAt(world.bridges, ground(sx, sz), sx, LOOP.deck, sz), ground(sx, sz));
  // off its ends the road is the ground
  for (const [x, z] of [on(-0.2), on(1.2)]) assert.equal(standAt(world.bridges, ground(x, z), x, ground(x, z), z), ground(x, z));
  // and a bridge far higher than this one (as one may be built some day) is as much a deck: thirty metres and more over the ground, and stood on
  const tall: Bridge = { ax: 0, ay: 60, az: 0, bx: 80, by: 64, bz: 0 };
  assert.equal(standAt([tall], 2, 40, 62, 0), 62);
  assert.equal(standAt([tall], 2, 40, 2, 0), 2);
  assert.equal(onBridge(tall, 40, 3).side, 3);
});

ok('what is solid of it is where the road is: one deck from bank to bank at the road\'s own height, rails either side but for the gap, and piers down into the ground', () => {
  const boxes = bridgeBoxes(b, ground);
  const deck = boxes.filter((q) => q.name === 'deck');
  assert.equal(deck.length, 1, `${deck.length} pieces of deck: a wheel catches on a joint`);
  assert.ok(Math.abs(deck[0].y + deck[0].hy - LOOP.deck) < 0.002, `the deck's top is at ${(deck[0].y + deck[0].hy).toFixed(3)} m`);
  assert.ok(Math.max(deck[0].hx, deck[0].hz) * 2 >= spanOf(b) - 0.01, 'the deck does not reach from bank to bank');
  for (const q of boxes) assert.ok(q.y + q.hy <= LOOP.deck + BRIDGE.kerb + BRIDGE.rail + 0.45, `${q.name} stands ${(q.y + q.hy - LOOP.deck).toFixed(2)} m over the deck`);
  const rails = boxes.filter((q) => q.surface === 'metal');
  assert.ok(rails.length >= 3, 'no railing that stops a car');
  // (and at each end a slab that brings a wheel from the road onto the deck with no lip to catch on: its far edge at the deck's own height)
  const slabs = boxes.filter((q) => q.name === 'approach' && q.surface === 'asphalt');
  assert.equal(slabs.length, 2, 'no slab onto the deck at one of its ends');
  for (const q of slabs) assert.ok(q.y + q.hy + Math.abs(Math.sin(q.tilt ?? 0)) * Math.max(q.hx, q.hz) > LOOP.deck - 0.12 && q.y + q.hy < LOOP.deck + 0.4, `a slab onto the deck ends ${(q.y + q.hy - LOOP.deck).toFixed(2)} m off it`);
  assert.ok(boxes.some((q) => q.surface === 'concrete' && q.y - q.hy < ground(q.x, q.z) - 0.5 && q.y + q.hy > LOOP.deck - 4), 'no pier that stands in the ground and reaches the deck');
});

// ---------------------------------------------------------------- the server's own checks

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  constructor(public name: string, public key = `bridge-test-key-${name}-${String(Math.random()).slice(2, 14).padStart(20, '0')}`) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.send({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name });
    for (let k = 0; k < 200 && !this.shut && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    assert.ok(w, `${this.name} was not let in`);
    this.id = w.you;
  }
  send(m: unknown) {
    if (!this.shut) this.ws.send(JSON.stringify(m));
  }
  /** where they say they are */
  say(x: number, y: number, z: number, yaw = 0) {
    this.send({ t: 's', p: [x, y, z, yaw, 0, 1], w: null, m: [] });
  }
  get kicked(): string | undefined {
    return (this.got.find((m) => m.t === 'kick') as { reason: string } | undefined)?.reason;
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-bridge-'));
const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', LINGER_S: '0', CHECKS: 'enforce', BOTCHECK: 'off', JEEPS: 'on' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
const flags = (name: string) => logged.split('\n').filter((l) => l.includes('[check') && l.includes(` ${name} `));
let failed: unknown = null;
try {
  for (let k = 0; k < 900 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);

  const walker = new Player('Walker'), under = new Player('Under'), driver = new Player('Driver'), hang = new Player('Hang');
  await Promise.all([walker.join(), under.join(), driver.join(), hang.join()]);
  const len = spanOf(b), [ex, ez] = on(-8 / len), [mx, mz] = on(0.5);
  const jeep = jeepSpots(world)[0];
  // (the jeep that stands there, by the number the server gave it)
  const told = (driver.got.find((m) => m.t === 'welcome') as { vehicles?: { i: number; s: number[] }[] }).vehicles ?? [];
  const car0 = told.slice().sort((p, q) => Math.hypot(p.s[0] - jeep.x, p.s[2] - jeep.z) - Math.hypot(q.s[0] - jeep.x, q.s[2] - jeep.z))[0];
  assert.ok(car0 && Math.hypot(car0.s[0] - jeep.x, car0.s[2] - jeep.z) < 1, 'no jeep stands where the first of them is to stand');

  // each is set down where they begin, and a moment is given for it (as it is given to anybody set down anywhere)
  walker.say(ex, ground(ex, ez), ez);
  under.say(mx, ground(mx, mz), mz);
  driver.say(jeep.x + 2, ground(jeep.x + 2, jeep.z), jeep.z);
  hang.say(0, ground(0, 0), 0);
  await sleep(2800);
  driver.send({ t: 'vin', i: car0.i, seat: 0 });
  await sleep(2800);

  /** ten times a second, for as long as `secs`: where each of them says they are */
  const play = async (secs: number, each: (t: number) => void) => {
    const from = Date.now();
    for (let t = 0; t < secs; t = (Date.now() - from) / 1000) {
      each(t);
      await sleep(100);
    }
  };
  // the jeep's way: straight to the east end of the bridge at 50 m/s (the server lets a jeep go 64), across it at 20, and stopped in the middle of it
  const far = Math.hypot(ex - jeep.x, ez - jeep.z), there = far / 50;
  const car = (t: number): [number, number, number, number] => {
    if (t < there) return [jeep.x + ((ex - jeep.x) * t) / there, Math.max(ground(jeep.x, jeep.z), LOOP.deck) + 40 * Math.sin((Math.PI * t) / there), jeep.z + ((ez - jeep.z) * t) / there, 50];
    const along = Math.min(0.5, -8 / len + ((t - there) * 20) / len), [x, z] = on(along);
    return [x, Math.max(ground(x, z), deckAt(world.bridges, x, z) ?? -1e9), z, along < 0.5 ? 20 : 0];
  };
  const total = there + (len / 2 + 8) / 20 + 15;
  let out = false;
  await play(total, (t) => {
    // the walker: across at a walk, back at a sprint with empty hands, then stood in the middle of it
    const walk = (len + 16) / 4, sprint = (len + 16) / 7.4;
    const along = t < walk ? -8 + 4 * t : t < walk + sprint ? len + 8 - 7.4 * (t - walk) : Math.min(len / 2, -8 + 3 * (t - walk - sprint));
    const [wx, wz] = on(along / len);
    walker.say(wx, Math.max(ground(wx, wz), deckAt(world.bridges, wx, wz) ?? -1e9), wz);
    // in the cleft under the middle of it, moving about a little as somebody waiting does
    const [ux, uz] = on(0.5 + 0.03 * Math.sin(t), 2 * Math.cos(t * 0.7));
    under.say(ux, ground(ux, uz), uz);
    // the driver, in the jeep while it goes and on the deck beside it once it has stopped
    const [cx, cy, cz, v] = car(t);
    if (t < total - 13) {
      const q = yawQuat(Math.atan2(-(ex - jeep.x), -(ez - jeep.z)));
      driver.send({ t: 'v', i: car0.i, s: [cx, cy + RIDE_HEIGHT, cz, ...q, 0, 0, 0, 0, v > 0 ? 1 : 0], at: Date.now() });
      driver.say(cx, cy + 0.6, cz);
    } else {
      if (!out) driver.send({ t: 'vout' });
      out = true;
      const [dx, dz] = on(0.5, 2.6);
      driver.say(dx, deckAt(world.bridges, dx, dz)!, dz);
    }
    // forty metres over the valley's floor with nothing under them, far from any bridge
    hang.say(0, ground(0, 0) + (t > 3 ? 40 : 0), 0);
  });
  await sleep(400);

  ok('nobody on the bridge is written down: walking it, sprinting it, standing on it for a quarter of a minute', () => {
    assert.deepEqual(flags('Walker'), []);
    assert.equal(walker.kicked, undefined);
  });
  ok('nor somebody in the cleft under it, who is on the ground and not under it', () => {
    assert.deepEqual(flags('Under'), []);
    assert.equal(under.kicked, undefined);
  });
  ok('nor somebody who drives to it, across it, stops on it and gets out', () => {
    assert.deepEqual(flags('Driver'), []);
    assert.equal(driver.kicked, undefined);
  });
  ok('and the check they were all under is awake: somebody hung in the air over open ground is written down', () => {
    assert.ok(flags('Hang').some((l) => /m over the ground/.test(l)), `nothing was written of Hang:\n${logged.split('\n').filter((l) => l.includes('[check')).join('\n')}`);
  });
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
  console.error(logged.slice(-1500));
  throw failed;
}
void loopLine;
console.log(`\n${n} checks passed`);
process.exit(0);
