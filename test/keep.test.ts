// What is kept between the server's restarts (server/index.ts under that heading, api/keep.ts): a character and a
// stash outlast the server that held them. The real game server is started, stopped dead and started again, with a
// stand-in for the site on this machine: the real api/admin and api/keep code over a store that is a variable.
// Nothing here touches the real site or its store. About forty seconds.
//   npx tsx test/keep.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { admin } from '../api/admin';
import { keep, type Kept } from '../api/keep';
import type { Store } from '../api/_lib/store';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { noBurying } from '../src/sim/stash';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8151, SITE = 8152;
// (a password made up here, for this test's stand-in site and nothing else)
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

// ---- the site, standing here: its files in a variable
const files = new Map<string, { text: string; mark: number }>();
let writes = 0;
const store: Store = {
  async read<T>(p: string) {
    const f = files.get(p);
    return f ? { data: JSON.parse(f.text) as T, mark: String(f.mark) } : null;
  },
  async glance<T>(p: string) {
    const f = files.get(p);
    return f ? (JSON.parse(f.text) as T) : null;
  },
  async swap(p, data, mark) {
    const f = files.get(p);
    if ((f ? String(f.mark) : null) !== mark) return false;
    writes++;
    files.set(p, { text: JSON.stringify(data), mark: (f?.mark ?? 0) + 1 });
    return String((f?.mark ?? 0) + 1);
  },
  async list() {
    return [...files.keys()];
  },
};
const env = { ADMIN_PASSWORD: PASSWORD };
const site = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${SITE}`);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(url, { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) });
  const out = url.pathname === '/api/admin' ? await admin(request, store, `http://127.0.0.1:${PORT}`, env) : url.pathname === '/api/keep' ? await keep(request, store, env) : new Response('not here', { status: 404 });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(await out.text());
});
await new Promise<void>((done) => site.listen(SITE, '127.0.0.1', done));
const kept = () => (files.has('zona/world.json') ? (JSON.parse(files.get('zona/world.json')!.text) as Kept) : null);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  constructor(public name: string, public key = `keep-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
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
    // (whoever arrives before what was kept has been read waits in the line: a while longer than usual)
    for (let k = 0; k < 400 && !this.shut && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    if (!w) return false;
    this.id = w.you;
    return true;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  last<T extends S2C['t']>(t: T) {
    return this.got.filter((m) => m.t === t).pop() as Extract<S2C, { t: T }> | undefined;
  }
}

async function withServer(play: (log: () => string) => Promise<void>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-keep-'));
  const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'on', KEEP_EVERY_MIN: '0.04', KEEP_WAIT_S: '3' },
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
    // (stopped dead: no last word is said)
    server.kill();
    await sleep(600);
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
}

let checks = 0;
const ann = new Player('Ann'), bob = new Player('Bob');
const rifle = { uid: 'keep-test-rifle', id: 'ak', qty: 1, loaded: 0, mag: null };
const tin = { uid: 'keep-test-tin', id: 'beans', qty: 1 };
// (out in the country, where a stash can be buried)
let at: [number, number] = [0, 0];
for (let x = -300, found = false; x <= 300 && !found; x += 20) for (let z = -300; z <= 300 && !found; z += 20) if (!noBurying(x + 2, ground(x + 2, z), z, ground(x + 2, z), world.pois, world.buildings)) [at, found] = [[x, z], true];
const stash = { uid: 'keep-test-stash', x: at[0] + 2, y: ground(at[0] + 2, at[1]), z: at[1], rot: 0.5, item: 'black_bag' };
/** a suitcase left lying beside it, with a tin in it too: kept as it lies, with no shovel put to it */
const lying = { uid: 'keep-test-suitcase', id: 'old_suitcase', qty: 1, cargo: [{ item: { uid: 'keep-test-tin-2', id: 'beans', qty: 1 }, x: 2, y: 1, rot: false }] };

// ---- the first run: nothing was kept; she comes in, carries, puts a stash down with a tin in it
await withServer(async (log) => {
  assert.ok(await ann.join(), `nobody was let in with nothing kept:\n${log().slice(-500)}`);
  assert.ok(/\[keep\] nothing has been kept yet/.test(log()), 'it was not said that nothing had been kept');
  assert.equal(ann.last('welcome')!.me, null);
  ann.send({ t: 's', p: [at[0], ground(...at), at[1], 1.25, 0, 0], w: null, m: [] });
  ann.send({ t: 'me', inv: { slots: { primary: rifle }, active: null, containers: [] }, vitals: { health: 64, energy: 50, water: 40, stamina: 300, bleeding: false } });
  // (a black bag dropped with a tin in it, and buried; and a suitcase dropped beside it and left lying)
  ann.send({ t: 'drop', l: { item: { uid: stash.uid, id: 'black_bag', qty: 1, cargo: [{ item: tin, x: 0, y: 0, rot: false }] }, x: stash.x, y: stash.y, z: stash.z, rot: stash.rot } });
  ann.send({ t: 'drop', l: { item: lying, x: stash.x + 1.5, y: ground(stash.x + 1.5, stash.z), z: stash.z, rot: 1 } });
  ann.send({ t: 's', p: [at[0], ground(...at), at[1], 1.25, 0, 0], w: 'shovel', m: [] });
  await sleep(300);
  ann.send({ t: 'bury', uid: stash.uid, on: true });
  await sleep(300);
  assert.ok(ann.got.some((m) => m.t === 'stash+' && m.s.uid === stash.uid && m.s.buried), 'the bag she dropped could not be buried');
  // (written once she was in, and again as time goes by: the second has what she did since)
  for (let k = 0; k < 120 && !/time has gone by: 1 characters and 2 stashes/.test(log()); k++) await sleep(100);
  assert.ok(/\[keep\] time has gone by: 1 characters and 2 stashes written/.test(log()), `nothing was written to the site as time went by:\n${log().slice(-600)}`);
  const file = kept();
  assert.ok(file && !file.final && file.z.length > 100, 'the site holds nothing, or holds a last word that was never said');
  const raw = files.get('zona/world.json')!.text;
  assert.ok(![ann.key, 'keep-test-rifle', 'keep-test-stash', 'Ann'].some((s) => raw.includes(s)), 'what the site holds can be read by whoever comes by it');
  checks++;
  console.log('  ok  what a player carries, the bag she buried and the suitcase she left lying are written to the site, sealed');
});

// ---- nobody but the game server is answered
const bad = await fetch(`http://127.0.0.1:${SITE}/api/keep`, { method: 'POST', headers: { 'x-zona-at': String(Date.now()), 'x-zona-auth': 'f'.repeat(64) }, body: JSON.stringify({ op: 'load' }) });
assert.equal(bad.status, 403, 'somebody who is not the game server was answered');
const none = await fetch(`http://127.0.0.1:${SITE}/api/keep`, { method: 'POST', body: JSON.stringify({ op: 'save', z: 'AAAA' }) });
assert.equal(none.status, 403, 'somebody who is not the game server could write');
checks++;
console.log('  ok  the site answers nobody about it but the game server');

// ---- the server stopped dead, and is started again: she is where she was, with what she had, and so is the stash
const before = writes;
await withServer(async (log) => {
  assert.ok(await ann.join(), `she was not let in after the restart:\n${log().slice(-500)}`);
  assert.ok(/\[keep\] 1 characters and 2 stashes as they were kept/.test(log()), `what was kept was not read:\n${log().slice(-500)}`);
  // (who played before it stopped is still counted on the door's "played today": kept with the rest, server/seen.ts)
  const h = (await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json()) as { today?: number };
  assert.equal(h.today, 1, 'who had played before the restart was forgotten by it');
  const w = ann.last('welcome')!;
  assert.ok(Math.hypot(w.spawn.x - at[0], w.spawn.z - at[1]) < 0.5 && Math.abs(w.spawn.yaw - 1.25) < 0.01, `she is not where she was: ${JSON.stringify(w.spawn)}`);
  assert.equal((w.me?.inv.slots as Record<string, { id: string } | null>).primary?.id, 'ak', 'she has not what she carried');
  assert.equal(w.me?.vitals.health, 64, 'she is not as she was');
  assert.ok(w.stashes.some((s) => s.uid === stash.uid && Math.abs(s.x - stash.x) < 0.01 && s.buried && s.item === 'black_bag'), 'her stash is not where she buried it, or not buried, or not the bag it was');
  ann.send({ t: 's', p: [at[0], ground(...at), at[1], 1.25, 0, 0], w: 'shovel', m: [] });
  await sleep(200);
  const left = w.loot.find((l) => l.uid === lying.uid);
  assert.ok(left && left.item.id === 'old_suitcase' && left.item.cargo?.[0].item.id === 'beans' && left.item.cargo[0].x === 2 && Math.abs(left.x - stash.x - 1.5) < 0.01, 'the suitcase she left lying is not where it lay, or has not what was in it');
  ann.send({ t: 'bury', uid: stash.uid, on: false });
  await sleep(400);
  const dug = ann.got.filter((m): m is Extract<S2C, { t: 'loot+' }> => m.t === 'loot+').map((m) => m.l).find((l) => l.uid === stash.uid);
  assert.deepEqual(dug?.item.cargo?.map((q) => q.item.id), ['beans'], 'what was in the bag she buried is not in it when it is dug up');
  // (and somebody who was never here begins as anybody does)
  assert.ok(await bob.join());
  assert.equal(bob.last('welcome')!.me, null);
  // (once somebody is on, the file says this server is the one that is alive)
  for (let k = 0; k < 60 && writes === before; k++) await sleep(100);
  assert.ok(writes > before, 'the server that is alive now never said so');
  checks++;
  console.log('  ok  after the server is stopped dead and started again: she is where she was, as she was, with what she carried; the bag she buried and the suitcase she left lying have what she put in them');
});

site.close();
console.log(`\n${checks} checks passed`);
process.exit(0);
