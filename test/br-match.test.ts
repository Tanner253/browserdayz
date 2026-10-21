// The battle royale's server (arena/br/match.ts, in arena/server.ts): four players find a duo lobby, vote it to start,
// are flown over the map and jump, one takes a gun off the ground, a foe is knocked and got up again by their teammate,
// then both foes fall and the match is won. The real server is started on a port of its own.   npx tsx test/br-match.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';
import { kindOf, type Ground } from '../arena/br/rules';

const PORT = 8241;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const g = (x: number, z: number) => heightAt(world.surface, x, z);

type M = Record<string, unknown> & { t: string; k?: string };
class Player {
  ws!: WebSocket;
  got: M[] = [];
  id = 0;
  pose: number[] = [0, 0, 0, 0, 0, 0];
  constructor(public name: string) {}
  async open(q: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/arena?${q}`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as M;
      if (m.t === 'welcome') this.id = m.you as number;
      this.got.push(m);
    });
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `br-test-${this.name}`.padEnd(40, '0'), name: this.name }));
  }
  async until(t: string, k: string | null, ms = 8000, also: (m: M) => boolean = () => true) {
    for (let n = 0; n < ms / 50; n++) {
      const m = [...this.got].reverse().find((x) => x.t === t && (!k || x.k === k) && also(x));
      if (m) return m;
      await sleep(50);
    }
    throw new Error(`${this.name} never heard ${t}${k ? '/' + k : ''}`);
  }
  br(m: Record<string, unknown>) { this.ws.send(JSON.stringify({ t: 'br', ...m })); }
  /** down out of the sky onto (x, z): a pose high over it first, then on the ground */
  async land(x: number, z: number) {
    this.ws.send(JSON.stringify({ t: 's', p: [x, g(x, z) + 60, z, 0, 0, 0], w: null, m: [] }));
    await sleep(80);
    this.pose = [x, g(x, z), z, 0, 0, 8];
    this.ws.send(JSON.stringify({ t: 's', p: this.pose, w: null, m: [] }));
    await sleep(80);
  }
  shootAt(o: Player, w: string) {
    const eye = [this.pose[0], this.pose[1] + 1.6, this.pose[2]], chest = [o.pose[0], o.pose[1] + 1.25, o.pose[2]];
    this.ws.send(JSON.stringify({ t: 'shot', o: eye, d: chest.map((v, i) => v - eye[i]), w, sup: false }));
  }
}

const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'arena/server.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let n = 0;
const ok = (name: string) => { n++; console.log('  ok  ' + name); };
try {
  for (let k = 0; k < 1500 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('places for things ready'), `the battle royale did not start:\n${logged.slice(-1200)}`);
  ok(logged.match(/\[br\] ground and .*/)![0]);

  const [a1, a2, b1, b2] = ['Ann', 'Abe', 'Bea', 'Bob'].map((s) => new Player(s));
  for (const p of [a1, a2, b1, b2]) {
    await p.open('w=br&size=2&kills=2&loadout=find');
    await p.until('welcome', null);
  }
  const lob = await b2.until('br', 'lobby', 4000, (m) => m.have === 4);
  assert.equal(lob.need, 3);
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/br/lobbies`)).json()) as { lobbies: { have: number }[] };
  assert.equal(list.lobbies[0].have, 4);
  ok('four in one duo lobby, listed; three votes of four needed');

  for (const p of [a1, a2, b1]) p.br({ k: 'vote', yes: true });
  await a1.until('br', 'lobby', 3000, (m) => (m.at as number) > 0);
  ok('the vote passed: the count is on');
  const plane = await a1.until('br', 'plane', 15000);
  await a1.until('br', 'zone', 2000);
  const loot = (await a1.until('br', 'loot', 2000, (m) => !!m.all)).add as Ground[];
  assert.ok(loot.length > 200, `only ${loot.length} things on the ground`);
  await sleep(300);
  const jeeps = a2.got.filter((m) => m.t === 'v+').map((m) => m.v as { i: number; s: number[] });
  assert.ok(jeeps.length > 0, 'no jeeps on the map');
  await a2.land(jeeps[0].s[0] + 1.5, jeeps[0].s[2]);
  a2.ws.send(JSON.stringify({ t: 'vin', i: jeeps[0].i, seat: 0 }));
  const seat = await b1.until('vseat', null, 3000);
  assert.equal((seat.seats as number[])[0], a2.id);
  a2.ws.send(JSON.stringify({ t: 'vout' }));
  ok(`${jeeps.length} jeeps stand on the map; ${a2.name} got in at the wheel and out again`);
  ok(`the plane flies (${(plane.a as number[]).map(Math.round)} to ${(plane.b as number[]).map(Math.round)}), the circle is set, ${loot.length} things lie on the map`);

  // a gun in the open, and everybody down beside it
  const gun = loot.find((x) => x.item && kindOf(x.item.id) === 'gun' && Math.abs(x.y - g(x.x, x.z)) < 0.2 && Math.abs(g(x.x + 9, x.z) - g(x.x, x.z)) < 1.5)!;
  assert.ok(gun, 'no gun lies in the open');
  for (const p of [a1, a2, b1, b2]) p.br({ k: 'jump' });
  await a1.land(gun.x, gun.z);
  await a2.land(gun.x - 5, gun.z);
  await b1.land(gun.x + 8, gun.z);
  await b2.land(gun.x + 9.5, gun.z);
  a1.br({ k: 'take', id: gun.id, slot: 1 });
  const mine = await a1.until('br', 'me', 3000, (m) => (m.slots as ({ id: string } | null)[]).some((s) => s?.id === gun.item!.id));
  ok(`${a1.name} took the ${gun.item!.id} off the ground: slots ${(mine.slots as ({ id: string } | null)[]).map((s) => s?.id ?? '-').join(' ')}`);

  const w = gun.item!.id;
  const fire = async (at: Player, until: () => boolean, most = 60) => {
    for (let k = 0; k < most && !until(); k++) { a1.shootAt(at, w); await sleep(900); }
  };
  const knocked = () => b1.got.some((m) => m.t === 'br' && m.k === 'me' && m.knocked);
  await fire(b1, knocked);
  assert.ok(knocked(), `${b1.name} was never knocked`);
  ok(`${b1.name} is knocked (a teammate still stands)`);

  b2.pose = [b1.pose[0] + 1.2, b1.pose[1], b1.pose[2], 0, 0, 8];
  b2.ws.send(JSON.stringify({ t: 's', p: b2.pose, w: null, m: [] }));
  b2.br({ k: 'rev', id: b1.id, on: true });
  const keep = setInterval(() => b2.ws.send(JSON.stringify({ t: 's', p: b2.pose, w: null, m: [] })), 200);
  await b1.until('hp', null, 14000, (m) => m.health === 30);
  clearInterval(keep);
  ok(`${b2.name} stood over ${b1.name} for 10 s and got them up with 30`);

  const dead = (p: Player) => () => p.got.some((m) => m.t === 'kill' && m.who === p.name);
  await fire(b1, dead(b1), 80);
  await fire(b2, dead(b2), 80);
  const won = await a1.until('br', 'over', 5000);
  assert.deepEqual([...(won.winners as string[])].sort(), ['Abe', 'Ann']);
  const place = (await b1.until('br', 'out', 1000)).place;
  assert.equal(place, 2);
  ok(`both foes out (placed ${place}); won by ${(won.winners as string[]).join(' & ')}`);

  const board = (await (await fetch(`http://127.0.0.1:${PORT}/br/board`)).json()) as { players: { name: string; wins: number; kills: number }[] };
  const ann = board.players.find((s) => s.name === 'Ann')!;
  assert.ok(ann.wins === 1 && ann.kills === 2, JSON.stringify(ann));
  ok(`the board: Ann 1 win, ${ann.kills} kills`);
  console.log(`br-match: ${n} checks passed`);
} catch (e) {
  console.error(e, '\n--- server ---\n' + logged.slice(-2000));
  process.exitCode = 1;
} finally {
  server.kill();
  process.exit();
}
