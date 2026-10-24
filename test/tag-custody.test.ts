// A dog tag is cashed in only by whoever the server saw take it and still holds it (server/custody.ts; the owner,
// 2026-10-23: "i keep getting paid for tags as admin that i either trashed, or deleted or dropped on the ground").
// A game's word that a tag is in its pockets is not enough: dropped, then cashed, is refused; put back on a body, then
// cashed, is refused; one lying on the ground, claimed by somebody else, is refused; dropped and picked up again, its
// clock starts again. Each of these was cashed in by the old server. The real server on a port of its own, with short
// times, and players over the wire. About a minute.
//   npx tsx test/tag-custody.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8321;
const HOLD_S = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

interface Tag { uid: string; id: 'dogtag'; qty: 1; owner: string; held?: number }
let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  x = 0;
  constructor(public name: string, public key = `tag-custody-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.send({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name });
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    assert.ok(w, `${this.name} was not let in`);
    this.id = w.you;
  }
  send(m: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  say(x: number, w: string | null = null) {
    this.x = x;
    this.send({ t: 's', p: [x, ground(x, 0), 0, 0, 0, 0], w, m: [] });
  }
  /** what their game says they carry: their own tag, and these taken off others */
  carry(tags: Tag[] = []) {
    const items = [{ uid: `own-${this.name}`, id: 'dogtag', qty: 1, owner: this.name }, ...tags].map((t, i) => ({ ...t, x: i % 5, y: Math.floor(i / 5), rot: false }));
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'tags', items }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-tag-custody-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'off', TAG_FRESH_S: '1', TAG_MIN_LIFE_S: '1', FRESH_S: '0.2', CASH_HOLD_S: String(HOLD_S) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
const cashedIn = (who: string, owner: string) => logged.includes(`${who} cashed in ${owner}'s dog tag`);

let checks = 0, failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const ann = new Player('Ann'), bob = new Player('Bob'), dan = new Player('Dan'), eve = new Player('Eve'), fay = new Player('Fay');
  for (const p of [ann, bob, dan, eve, fay]) await p.join();
  const spot = new Map([[ann, 30], [bob, 31], [dan, 32], [eve, 33], [fay, 34]]);
  for (let t = 0; t < 2400; t += 400) {
    for (const [p, x] of spot) p.say(x);
    for (const p of [dan, eve, fay]) p.carry();
    await sleep(400);
  }

  /** Ann shoots them, and their game says they died of it; the body's id */
  const kill = async (v: Player) => {
    v.carry();
    await sleep(200);
    ann.say(30, 'mosin');
    v.say(spot.get(v)!);
    await sleep(300);
    ann.send({ t: 'hit', to: v.id, w: 'mosin', zone: 'torso' });
    await sleep(300);
    v.send({ t: 'died', cause: 'shot' });
    for (let k = 0; k < 40 && !ann.got.some((m) => m.t === 'death' && m.k.id === v.id); k++) await sleep(50);
    const d = ann.got.find((m) => m.t === 'death' && m.k.id === v.id) as Extract<S2C, { t: 'death' }> | undefined;
    assert.ok(d?.corpse, `${v.name} was not killed, or left no body:\n${logged.slice(-800)}`);
    assert.ok(!logged.includes(`${v.name} left no dog tag`), `${v.name} left no tag:\n${logged.slice(-800)}`);
    return d.corpse.uid;
  };
  /** Ann opens a body, takes this tag off it, and her game says she carries it */
  const takeOff = async (cid: string, tag: Tag, carried: Tag[]) => {
    ann.got.length = 0;
    ann.send({ t: 'copen', cid });
    for (let k = 0; k < 40 && !ann.got.some((m) => m.t === 'cdata' && m.cid === cid); k++) await sleep(50);
    const data = ann.got.find((m) => m.t === 'cdata' && m.cid === cid) as Extract<S2C, { t: 'cdata' }> | undefined;
    assert.ok(data?.items.some((it) => it.uid === tag.uid), `${tag.owner}'s tag is not on the body`);
    ann.send({ t: 'cset', cid, items: data!.items.filter((it) => it.uid !== tag.uid) });
    ann.carry([...carried, tag]);
    await sleep(200);
    return data!.items;
  };
  const cash = async (p: Player, tag: Tag) => {
    p.send({ t: 'cash', uid: tag.uid });
    await sleep(500);
  };

  // ---- the honest way: off Dan's body, held the full time, cashed in
  const tDan: Tag = { uid: 'own-Dan', id: 'dogtag', qty: 1, owner: 'Dan' };
  const dBody = await kill(dan);
  await takeOff(dBody, tDan, []);
  await sleep(HOLD_S * 1000 + 600);
  ann.carry([tDan]);
  await cash(ann, tDan);
  assert.ok(cashedIn('Ann', 'Dan'), `a tag taken off a body and held was not cashed in:\n${logged.slice(-800)}`);
  ann.carry([]);
  checks++;
  console.log('  ok  a tag taken off a body and held the full time is cashed in');

  // ---- Eve's tag: taken, held, dropped at Ann's feet; her game still says it is in her pockets
  const tEve: Tag = { uid: 'own-Eve', id: 'dogtag', qty: 1, owner: 'Eve' };
  const eBody = await kill(eve);
  await takeOff(eBody, tEve, []);
  await sleep(HOLD_S * 1000 + 600);
  ann.send({ t: 'drop', l: { uid: tEve.uid, item: tEve, x: 30.4, y: ground(30.4, 0.3), z: 0.3, rot: 0, point: -1, spawnedAt: 0 } });
  await sleep(200);
  ann.carry([tEve]);
  await sleep(300);
  await cash(ann, tEve);
  assert.ok(!cashedIn('Ann', 'Eve'), `a tag dropped on the ground was cashed in from the pockets:\n${logged.slice(-800)}`);
  checks++;
  console.log('  ok  a tag dropped, then said to be in the pockets still, is not cashed in');

  // ---- Bob's game says he carries Eve's tag, which lies on the ground
  bob.carry([tEve]);
  await sleep(HOLD_S * 1000 + 600);
  bob.carry([{ ...tEve, held: 99999 }]);
  await cash(bob, tEve);
  assert.ok(!cashedIn('Bob', 'Eve'), `a tag lying on the ground was cashed in by somebody whose game said he had it:\n${logged.slice(-800)}`);
  checks++;
  console.log('  ok  a tag lying on the ground, said to be in somebody\'s pockets, is not cashed in');

  // ---- Ann picks Eve's tag up again: its clock starts again
  ann.send({ t: 'take', uid: tEve.uid });
  await sleep(200);
  ann.carry([tEve]);
  await sleep(200);
  await cash(ann, tEve);
  assert.ok(!cashedIn('Ann', 'Eve'), `a tag dropped and picked up again was cashed in at once, on its old clock:\n${logged.slice(-800)}`);
  await sleep(HOLD_S * 1000 + 600);
  ann.carry([tEve]);
  await cash(ann, tEve);
  assert.ok(cashedIn('Ann', 'Eve'), `a tag picked up again and held the full time was not cashed in:\n${logged.slice(-800)}`);
  ann.carry([]);
  checks++;
  console.log('  ok  a tag dropped and picked up again is held the full time again before it is cashed in');

  // ---- Fay's tag: taken, held, put back on her body; Ann's game still says it is in her pockets
  const tFay: Tag = { uid: 'own-Fay', id: 'dogtag', qty: 1, owner: 'Fay' };
  const fBody = await kill(fay);
  const rest = await takeOff(fBody, tFay, []);
  await sleep(HOLD_S * 1000 + 600);
  ann.send({ t: 'cset', cid: fBody, items: [...rest.filter((it) => it.uid !== tFay.uid), { ...tFay, x: 7, y: 16, rot: false }] });
  await sleep(200);
  ann.carry([tFay]);
  await sleep(300);
  await cash(ann, tFay);
  assert.ok(!cashedIn('Ann', 'Fay'), `a tag put back on a body was cashed in from the pockets:\n${logged.slice(-800)}`);
  checks++;
  console.log('  ok  a tag put back on a body, then said to be in the pockets still, is not cashed in');

  // ---- Ann takes Fay's tag off the body again and drops it in a day pack; Bob goes through the pack where it lies,
  // takes the tag out, carries it its time, and cashes it in (it was lost to him: taken out of a pack, it was not his)
  await takeOff(fBody, tFay, []);
  const pack = { uid: 'tag-custody-pack', id: 'sack_pack', qty: 1, cargo: [{ item: tFay, x: 0, y: 0, rot: false }] };
  ann.send({ t: 'drop', l: { uid: pack.uid, item: pack, x: 30.6, y: ground(30.6, 0.2), z: 0.2, rot: 0, point: -1, spawnedAt: 0 } });
  await sleep(200);
  ann.carry([]);
  bob.say(31);
  bob.got.length = 0;
  bob.send({ t: 'lopen', uids: [pack.uid] });
  for (let k = 0; k < 40 && !bob.got.some((m) => m.t === 'ldata' && m.uid === pack.uid); k++) await sleep(50);
  const inPack = bob.got.find((m) => m.t === 'ldata' && m.uid === pack.uid) as Extract<S2C, { t: 'ldata' }> | undefined;
  assert.ok(inPack?.items.some((it) => it.uid === tFay.uid), `Fay's tag is not in the pack where it lies:\n${logged.slice(-800)}`);
  bob.send({ t: 'lset', uid: pack.uid, items: inPack!.items.filter((it) => it.uid !== tFay.uid) });
  bob.send({ t: 'lclose' });
  bob.carry([tFay]);
  await sleep(HOLD_S * 1000 + 600);
  bob.carry([tFay]);
  await cash(bob, tFay);
  assert.ok(cashedIn('Bob', 'Fay'), `a tag taken out of a pack lying on the ground, and held, was not cashed in:\n${logged.slice(-800)}`);
  checks++;
  console.log('  ok  a tag dropped in a pack and taken out of it where it lies is the taker\'s, and is cashed in once held');
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) throw failed;
console.log(`${checks} checks passed`);
