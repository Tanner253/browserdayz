// The server's own checks on what a player's game tells it (CHECKS in server/index.ts): that nobody gets
// anywhere faster than legs or a jeep go; that a round does not pass through a hill; that nobody stands after
// more than a body can take; that a thing is taken from within reach; that a gun somebody carries is one the
// server put in the world; and that whoever is put off the server twice is kept off it. This starts the real
// server three times on a port of its own (enforcing, only watching, and enforcing with a short fuse) and plays
// players against it over the wire. About a minute.   npx tsx test/checks.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { ITEMS } from '../src/sim/items';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8139;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  at: [number, number] = [0, 0];
  shut = false;
  /** what was lying in the world when they arrived */
  loot: { uid: string; item: { uid: string; id: string; qty: number }; x: number; y: number; z: number }[] = [];
  constructor(public name: string, public key = `checks-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
  /** @returns whether they were let in */
  async join(): Promise<boolean> {
    this.got = [];
    this.shut = false;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.shut && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number; loot: Player['loot'] } | undefined;
    if (!w) return false;
    this.id = w.you;
    this.loot = w.loot;
    return true;
  }
  /** what they say is in their hands and pockets, and how they are */
  carry(slots: Record<string, object>, health = 100) {
    this.send({ t: 'me', inv: { slots, active: null, containers: [] }, vitals: { health, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
  hit(whom: Player, w: string) {
    this.send({ t: 'hit', to: whom.id, w, zone: 'torso' });
  }
  /** what they were told as they were put off the server */
  get kicked(): string | undefined {
    return (this.got.find((m) => m.t === 'kick') as { reason: string } | undefined)?.reason;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  /** where they say they are, standing on the ground there, with what they say they hold */
  say(x: number, z: number, w: string | null = null) {
    this.at = [x, z];
    this.send({ t: 's', p: [x, ground(x, z), z, 0, 0, 0], w, m: [] });
  }
  /** where somebody else was last said to be, to this player */
  sees(id: number): [number, number] | null {
    for (let k = this.got.length - 1; k >= 0; k--) {
      const m = this.got[k] as { t: string; s?: number[][] };
      const row = m.t === 'ps' ? m.s?.find((r) => r[0] === id) : undefined;
      if (row) return [row[1], row[3]];
    }
    return null;
  }
}

async function withServer(mode: string, play: (log: () => string) => Promise<void>, more: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-checks-'));
  // (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
  const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    // (each check's own refusals are what is watched here, a first minute's worth of them at a time: the handful that
    // sends somebody back to the bot check in their first minute would take them out of the test first. That is
    // test/probation.test.ts's.)
    env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', LINGER_S: '0', CHECKS: mode, FIRST_FLAGS: '100000', ...more },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logged = '';
  server.stdout!.on('data', (d) => (logged += d));
  server.stderr!.on('data', (d) => (logged += d));
  let failed: unknown = null;
  try {
    for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
    assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
    await play(() => logged);
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
    console.error(logged.slice(-900));
    throw failed;
  }
}

// two places with a hill between them, and two with nothing between them: found on the map as it is
const over = (a: [number, number], b: [number, number]) => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), ay = ground(...a) + 1.5, by = ground(...b) + 1.1;
  let most = -1e9;
  for (let s = 5; s < d - 5; s += 2) most = Math.max(most, ground(a[0] + ((b[0] - a[0]) * s) / d, a[1] + ((b[1] - a[1]) * s) / d) - (ay + ((by - ay) * s) / d));
  return most;
};
let hidden: [[number, number], [number, number]] | null = null, open: [[number, number], [number, number]] | null = null;
for (let x = -300; x <= 300 && !(hidden && open); x += 20) {
  for (let z = -300; z <= 300 && !(hidden && open); z += 20) {
    const a: [number, number] = [x, z], b: [number, number] = [x + 110, z + 30], h = over(a, b);
    if (!hidden && h > 8) hidden = [a, b];
    if (!open && h < -1.5) open = [a, b];
  }
}
assert.ok(hidden && open, 'the map has no two places with a hill between them, or none with nothing between them');

let checks = 0;
await withServer('enforce', async (log) => {
  // ---- nobody gets anywhere faster than legs go
  const ann = new Player('Ann'), bee = new Player('Bee');
  await ann.join();
  await bee.join();
  bee.say(4, 4);
  // (set down, and a moment given for it: then a run, as fast as anybody runs with nothing in their hands)
  ann.say(0, 0);
  await sleep(2700);
  for (let k = 1; k <= 30; k++) {
    ann.say(k * 0.74, 0);
    bee.say(4, 4);
    await sleep(100);
  }
  await sleep(300);
  assert.ok(!/\[check/.test(log()), `a check fired on somebody running:\n${log().split('\n').filter((l) => l.includes('[check')).join('\n')}`);
  const ran = bee.sees(ann.id);
  assert.ok(ran && Math.abs(ran[0] - 22.2) < 1.5, `Bee sees Ann at ${ran}, and she ran to 22.2, 0`);
  // and then says she is three hundred metres off
  for (let k = 0; k < 8; k++) {
    ann.say(320, 0);
    bee.say(4, 4);
    await sleep(100);
  }
  await sleep(300);
  assert.ok(/\[check:enforce\] Ann moved 29\d m/.test(log()), 'nothing was written down of a jump across the map');
  const kept = bee.sees(ann.id);
  assert.ok(kept && Math.abs(kept[0] - 22.2) < 1.5, `Bee sees Ann at ${kept} after the jump: she is to be kept where she was`);
  // back where she was, she is believed again
  ann.say(23, 0);
  await sleep(400);
  const back = bee.sees(ann.id);
  assert.ok(back && Math.abs(back[0] - 23) < 0.5, `Bee sees Ann at ${back} once she is back where she could be`);
  ann.ws.close();
  bee.ws.close();
  checks++;
  console.log('  ok  a run is a run; a jump across the map is refused, written down, and nobody else sees it');

  // ---- a little too fast, every time, is too fast: what is let go is owed (it used to be forgotten, and twice the
  // pace of a sprint could be held for as long as anybody liked with nothing written down)
  const rex = new Player('Rex'), sam = new Player('Sam');
  await rex.join();
  await sam.join();
  sam.say(4, -40);
  rex.say(0, -40);
  await sleep(2700);
  // (20 m/s for six seconds, each step by itself inside what is let go at any one time)
  const began = Date.now();
  for (let k = 1; k <= 60; k++) {
    rex.say(k * 2, -40);
    sam.say(4, -40);
    await sleep(100);
  }
  const took = (Date.now() - began) / 1000;
  await sleep(300);
  assert.ok(/\[check:enforce\] Rex moved/.test(log()), 'nothing was written down of somebody going twice as fast as a sprint for six seconds');
  const got = sam.sees(rex.id);
  // (as far as legs go in the time, with the two seconds saved, what is let go once, and what may be owed)
  assert.ok(got && got[0] < 9.5 * took + 19 + 3 + 30 + 2 && got[0] > 40, `Sam sees Rex at ${got} after ${took.toFixed(1)} s: he said 120, and legs with every allowance go ${(9.5 * took + 52).toFixed(0)}`);
  // and a line that was held up and lets go all at once is still believed: four seconds of a run, in one burst
  const tia = new Player('Tia');
  await tia.join();
  tia.say(0, -80);
  await sleep(2700);
  for (let k = 1; k <= 10; k++) {
    tia.say(k * 0.74, -80);
    await sleep(100);
  }
  // (TEN seconds, and everything her game said in them let go at once: a hundred steps of a sprint. With two seconds
  // saved and thirty metres owed she was refused from the sixty-sixth on, fifty times, and put off the server.)
  await sleep(10000);
  for (let k = 11; k <= 110; k++) tia.say(k * 0.74, -80);
  for (let k = 111; k <= 130; k++) {
    tia.say(k * 0.74, -80);
    sam.say(4, -40);
    await sleep(100);
  }
  await sleep(300);
  assert.ok(!/\[check:enforce\] Tia/.test(log()) && !/Tia is put off/.test(log()), `a check fired on a line that was held up:\n${log().split('\n').filter((l) => l.includes('Tia')).join('\n')}`);
  assert.ok(!tia.kicked && !tia.shut, 'somebody whose line was held up for ten seconds was put off the server');
  const there = sam.sees(tia.id);
  assert.ok(there && Math.abs(there[0] - 96.2) < 1.5, `Sam sees Tia at ${there}, and she ran to 96.2`);
  for (const p of [rex, sam, tia]) p.ws.close();
  checks++;
  console.log('  ok  a little too fast every time is refused once it adds up; a line held up and let go at once is believed');

  // ---- a round does not go through a hill
  const cid = new Player('Cid'), dee = new Player('Dee'), eve = new Player('Eve'), fay = new Player('Fay');
  for (const p of [cid, dee, eve, fay]) await p.join();
  // (each stood where they are to be, in the moment after arriving in which that is not questioned)
  cid.say(...hidden![0], 'mosin');
  dee.say(...hidden![1]);
  eve.say(...open![0], 'mosin');
  fay.say(...open![1]);
  await sleep(300);
  cid.send({ t: 'hit', to: dee.id, w: 'mosin', zone: 'torso' });
  eve.send({ t: 'hit', to: fay.id, w: 'mosin', zone: 'torso' });
  await sleep(600);
  assert.ok(!dee.got.some((m) => m.t === 'dmg'), 'somebody was hit through a hill');
  assert.ok(/\[check:enforce\] Cid shot Dee through/.test(log()), 'nothing was written down of a shot through a hill');
  assert.ok(fay.got.some((m) => m.t === 'dmg'), `somebody in plain sight was not hit:\n${log().slice(-400)}`);
  for (const p of [cid, dee, eve, fay]) p.ws.close();
  checks++;
  console.log('  ok  a round through a hill hits nobody and is written down; one across open ground hits');

  // ---- nobody stands after more than a body can take
  const gil = new Player('Gil'), hal = new Player('Hal'), ivy = new Player('Ivy');
  for (const p of [gil, hal, ivy]) await p.join();
  gil.say(...open![0], 'mosin');
  hal.say(...open![1]);
  ivy.say(open![1][0] + 3, open![1][1]);
  await sleep(300);
  // Ivy is hit once, says how she is, and dies of the second as anybody would: nothing is said of her
  gil.hit(ivy, 'mosin');
  await sleep(700);
  ivy.carry({}, 5);
  gil.hit(ivy, 'mosin');
  await sleep(200);
  ivy.send({ t: 'died', cause: 'gunshot wounds' });
  // Hal is hit six times and never says he is dead. (His game goes on saying where he is: one that said nothing
  // at all would be a body with nobody in it, whose life the server keeps, and it would have died of the second.)
  const up = setInterval(() => hal.say(...open![1]), 300);
  for (let k = 0; k < 6; k++) {
    await sleep(650);
    gil.hit(hal, 'mosin');
  }
  await sleep(2800);
  clearInterval(up);
  assert.ok(/\[check:enforce\] Hal is on their feet after/.test(log()), `nothing was written down of somebody who cannot be killed:\n${log().slice(-500)}`);
  assert.ok(hal.got.some((m) => m.t === 'death' && (m as { k: { id: number } }).k.id === hal.id), 'the server did not say he was dead');
  assert.ok(!/Ivy is on their feet/.test(log()), 'somebody who died as anybody would was written down');
  for (const p of [gil, hal, ivy]) p.ws.close();
  checks++;
  console.log('  ok  whoever is hit past what a body can take and stays up is written down, and the server says they are dead');

  // ---- a thing is taken from within reach
  const jon = new Player('Jon'), kay = new Player('Kay');
  await jon.join();
  await kay.join();
  const lying = jon.loot.find((l) => Math.hypot(l.x, l.z) < 300)!;
  jon.say(lying.x + 120, lying.z);
  kay.say(lying.x + 1, lying.z);
  await sleep(300);
  jon.send({ t: 'take', uid: lying.uid });
  await sleep(400);
  assert.ok(jon.got.some((m) => m.t === 'denied' && (m as { uid: string }).uid === lying.uid), 'a thing was taken from 120 m away');
  assert.ok(/\[check:enforce\] Jon took .* from 120 m away/.test(log()), 'nothing was written down of it');
  kay.send({ t: 'take', uid: lying.uid });
  await sleep(400);
  assert.ok(!kay.got.some((m) => m.t === 'denied'), 'a thing was refused somebody standing over it');
  assert.ok(jon.got.some((m) => m.t === 'loot-' && (m as { uid: string }).uid === lying.uid), 'and it is still lying there');
  jon.ws.close();
  kay.ws.close();
  checks++;
  console.log('  ok  a thing lying in the world is taken from beside it, and not from across the map');

  // ---- under the ground nobody hits anybody or takes a thing (a rule of the game: it holds whatever CHECKS says)
  const ula = new Player('Ula'), vic = new Player('Vic');
  await ula.join();
  await vic.join();
  const thing = ula.loot.find((l) => Math.hypot(l.x, l.z) < 300 && l.uid !== lying.uid)!;
  ula.say(thing.x + 1, thing.z);
  vic.say(thing.x + 2.2, thing.z);
  await sleep(2700);
  // (on the ground a fist lands)
  ula.hit(vic, 'fists');
  await sleep(500);
  assert.ok(vic.got.some((m) => m.t === 'dmg'), 'a fist from beside somebody did not land');
  vic.got = [];
  // (then she says she is two and a half metres down in the earth, and goes on saying so)
  for (let k = 0; k < 9; k++) {
    ula.send({ t: 's', p: [thing.x + 1, ground(thing.x + 1, thing.z) - 2.5, thing.z, 0, 0, 0], w: null, m: [] });
    await sleep(500);
  }
  ula.hit(vic, 'fists');
  ula.send({ t: 'take', uid: thing.uid });
  await sleep(500);
  assert.ok(!vic.got.some((m) => m.t === 'dmg'), 'somebody was hit from under the ground');
  assert.ok(ula.got.some((m) => m.t === 'denied' && (m as { uid: string }).uid === thing.uid), 'a thing was taken from under the ground');
  assert.ok(/Ula is 2\.5 m under the ground/.test(log()), `nothing was written down of it:
${log().slice(-400)}`);
  // (and back on the ground she is in the game again)
  ula.say(thing.x + 1, thing.z);
  await sleep(300);
  ula.send({ t: 'take', uid: thing.uid });
  await sleep(400);
  assert.ok(ula.got.some((m) => m.t === 'loot-' && (m as { uid: string }).uid === thing.uid), 'back on the ground, a thing at her feet was refused her');
  ula.ws.close();
  vic.ws.close();
  checks++;
  console.log('  ok  under the ground nobody hits anybody or takes a thing; back on it they do');

  // ---- a gun somebody carries is one the server put in the world
  const lea = new Player('Lea'), mia = new Player('Mia'), ned = new Player('Ned'), oli = new Player('Oli');
  for (const p of [lea, mia, ned, oli]) await p.join();
  const gun = ned.loot.find((l) => !!ITEMS[l.item.id]?.weapon && Math.hypot(l.x, l.z) < 320);
  assert.ok(gun, 'there is no gun lying anywhere near the middle of the map');
  lea.say(...open![0], 'deagle');
  mia.say(open![0][0] + 8, open![0][1]);
  ned.say(gun.x + 1, gun.z, gun.item.id);
  oli.say(gun.x + 9, gun.z);
  await sleep(300);
  // Lea's is her own invention
  lea.carry({ holster: { uid: 'made-up-desert-eagle', id: 'deagle', qty: 1, loaded: 7 } });
  // Ned's he picks up off the ground
  ned.send({ t: 'take', uid: gun.uid });
  await sleep(400);
  ned.carry({ primary: { ...gun.item, loaded: 5 } });
  await sleep(300);
  lea.hit(mia, 'deagle');
  ned.hit(oli, gun.item.id);
  await sleep(600);
  assert.ok(/\[check:enforce\] Lea carries Desert Eagle/.test(log()), `nothing was written down of an invented gun:\n${log().slice(-500)}`);
  assert.ok(!mia.got.some((m) => m.t === 'dmg'), 'somebody was hit with an invented gun');
  assert.ok(!/Ned (carries|hit)/.test(log()), 'a gun picked up off the ground was taken for an invention');
  assert.ok(oli.got.some((m) => m.t === 'dmg'), 'a gun picked up off the ground hit nobody');
  // and she cannot put it down for somebody else to find, either
  lea.send({ t: 'drop', l: { item: { uid: 'made-up-desert-eagle', id: 'deagle', qty: 1 }, x: open![0][0], y: ground(...open![0]), z: open![0][1], rot: 0 } });
  await sleep(400);
  assert.ok(!mia.got.some((m) => m.t === 'loot+' && (m as { l: { item: { uid: string } } }).l.item.uid === 'made-up-desert-eagle'), 'an invented gun was put down in the world');
  for (const p of [lea, mia, ned, oli]) p.ws.close();
  checks++;
  console.log('  ok  an invented gun is written down, hits nobody and cannot be put down; one picked up off the ground is a gun');
});

await withServer('watch', async (log) => {
  // ---- only watching: the same things are written down, and nothing is refused
  const ann = new Player('Ann'), bee = new Player('Bee');
  await ann.join();
  await bee.join();
  ann.say(0, 0);
  bee.say(4, 4);
  await sleep(2700);
  for (let k = 0; k < 6; k++) {
    ann.say(320, 0);
    bee.say(4, 4);
    await sleep(100);
  }
  await sleep(300);
  assert.ok(/\[check:watch\] Ann moved 320 m/.test(log()), 'watching, nothing was written down of a jump across the map');
  const far = bee.sees(ann.id);
  assert.ok(far && Math.abs(far[0] - 320) < 1, `watching, Bee sees Ann at ${far}: nothing is to be refused`);
  const health = (await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json()) as { checks: string; flagged: number };
  assert.ok(health.checks === 'watch' && health.flagged >= 1, `the health page says ${JSON.stringify(health)}`);
  ann.ws.close();
  bee.ws.close();
  checks++;
  console.log('  ok  only watching, the same is written down and counted, and nothing is refused');
});

await withServer('enforce', async (log) => {
  // ---- kept off by name, and kept off after being put off twice
  const quin = new Player('Quin', 'checks-test-key-kept-off-by-name-0000001');
  assert.equal(await quin.join(), false, 'somebody kept off by name was let in');
  assert.ok(/kept off/.test(quin.kicked ?? ''), `he was told: ${quin.kicked}`);
  const pat = new Player('Pat');
  for (let time = 1; time <= 2; time++) {
    assert.equal(await pat.join(), true, `Pat was not let in the ${time === 1 ? 'first' : 'second'} time`);
    pat.say(0, 0);
    await sleep(2700);
    for (let k = 0; k < 14 && !pat.shut; k++) {
      pat.say(320, 0);
      await sleep(100);
    }
    await sleep(300);
    assert.ok(pat.shut && pat.kicked, `Pat was not put off the server the ${time === 1 ? 'first' : 'second'} time`);
  }
  assert.ok(/kept off it for a while/.test(pat.kicked ?? ''), `the second time he was told: ${pat.kicked}`);
  assert.equal(await pat.join(), false, 'put off twice, he was let in a third time');
  assert.ok(/Pat is not let in/.test(log()), 'the server kept no line of it');
  checks++;
  console.log('  ok  whoever is kept off by name is not let in; whoever the checks put off twice is kept off');
}, { CHECK_KICK: '1', BAN_KEYS: 'checks-test-key-kept-off-by-name-0000001' });

console.log(`${checks} checks passed`);
process.exit(0);
