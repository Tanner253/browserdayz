// A store finish put on one gun goes with that gun (server/plates.ts, PROTOCOL 59): the server checks the buyer owns
// it, and from then the gun wears it wherever it goes, dropped, looted, through a restart; a game's own word on a
// finish is never taken. First the record alone, then the real game server with a stand-in site (api/admin, api/keep
// and a perk list) on this machine, stopped dead and started again. Nothing here touches the real site.
//   npx tsx test/plates.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { admin } from '../api/admin';
import { keep } from '../api/keep';
import type { Store } from '../api/_lib/store';
import { ACCT_SALT, type PerkList } from '../api/_lib/shop-items';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { itemName, type ItemInstance } from '../src/sim/items';
import { plating } from '../server/plates';
import { generateWorld, heightAt } from '../src/world/worldgen';

let checks = 0;
const ok = (what: string) => (checks++, console.log(`  ok  ${what}`));

// ---- the record alone
{
  const gun = (uid: string, id = 'deagle'): ItemInstance => ({ uid, id, qty: 1, loaded: 0, mag: null });
  const inv = { slots: { holster: gun('u-1') }, active: 'holster' as const, containers: [{ id: 'pockets', items: [{ ...gun('u-2'), x: 0, y: 0, rot: false }] }] };
  const owns = () => 'deagle_gold' as const;
  assert.equal(plating.apply(inv, 'u-1', () => null), 'You have no finish for that');
  assert.equal(plating.apply(inv, 'u-9', owns), 'Carry it first');
  assert.equal(inv.slots.holster.finish, undefined);
  const done = plating.apply(inv, 'u-1', owns);
  assert.ok(typeof done !== 'string' && done.it.finish === 'deagle_gold' && done.f === 'deagle_gold', `not plated: ${JSON.stringify(done)}`);
  assert.equal(itemName(inv.slots.holster), 'Gold-plated Desert Eagle');
  assert.equal(plating.held(inv, 'deagle', 'u-1'), 'gold');
  assert.equal(plating.held(inv, 'deagle', 'u-2'), undefined);
  assert.equal(plating.held(inv, 'm9', 'u-1'), undefined);
  assert.equal(plating.apply(inv, 'u-1', owns), 'It wears it already');
  // (and on another of the same kind, in a pocket)
  assert.ok(typeof plating.apply(inv, 'u-2', owns) !== 'string' && inv.containers[0].items[0].finish === 'deagle_gold');
  ok('the server plates a carried gun only for a buyer of that finish, and as many of that kind as they like');

  // a game that says its own gun is gold is not believed; a plated uid said of another kind of thing is not plated
  const forged = plating.stamp({ ...gun('u-3'), finish: 'deagle_gold' });
  assert.ok(!forged.finish, 'a finish a game claimed for itself was kept');
  assert.ok(!plating.stamp(gun('u-1', 'm9')).finish, 'a plated uid put on an M9 plated it');
  const bare = plating.stamp(gun('u-1'));
  assert.equal(bare.finish, 'deagle_gold', 'a plated gun read in again lost its finish');
  // (in a pack, too)
  const pack = plating.stamp({ uid: 'p-1', id: 'backpack', qty: 1, cargo: [{ item: gun('u-2'), x: 0, y: 0, rot: false }] });
  assert.equal(pack.cargo![0].item.finish, 'deagle_gold');
  // (and what is kept is read back)
  const kept = JSON.parse(JSON.stringify(plating.keep())) as ReturnType<typeof plating.keep>;
  assert.equal(kept.length, 2);
  ok("a game's own word on a finish is stripped; the record's is written on the gun however it is read in, a pack's cargo too");
}

// ---- knives: any knife takes a knife's finish; one made a karambit stays one, its finish kept; a claimed one is not believed
{
  const knife = (uid: string, id = 'knife'): ItemInstance => ({ uid, id, qty: 1 });
  const inv = { slots: {}, active: null, containers: [{ id: 'pockets', items: [{ ...knife('k-1'), x: 0, y: 0, rot: false }, { ...knife('k-2', 'hunting_knife'), x: 1, y: 0, rot: false }] }] } as unknown as Parameters<typeof plating.apply>[0];
  const items = () => (inv as unknown as { containers: { items: ItemInstance[] }[] }).containers[0].items;
  const ruby = plating.apply(inv, 'k-2', () => 'knife_ruby');
  assert.ok(typeof ruby !== 'string' && ruby.it.finish === 'knife_ruby', 'a hunting knife did not take a knife finish');
  const made = plating.apply(inv, 'k-1', () => 'karambit');
  assert.ok(typeof made !== 'string' && made.it.id === 'karambit' && made.f === 'karambit', `not made a karambit: ${JSON.stringify(made)}`);
  assert.equal(plating.apply(inv, 'k-1', () => 'karambit'), 'It is one already');
  assert.ok(typeof plating.apply(inv, 'k-1', () => 'knife_emerald') !== 'string');
  assert.equal(items()[0].id, 'karambit');
  assert.equal(items()[0].finish, 'knife_emerald');
  // (read in again as the plain knife its game says it is, it is the karambit it was made, still emerald)
  const again = plating.stamp(knife('k-1'));
  assert.equal(again.id, 'karambit');
  assert.equal(again.finish, 'knife_emerald');
  // (a game that says it has a karambit it was never made has the knife)
  assert.equal(plating.stamp(knife('k-9', 'karambit')).id, 'knife');
  // (and both are kept over a restart)
  const kept = JSON.parse(JSON.stringify(plating.keep())) as ReturnType<typeof plating.keep>;
  const k1 = kept.find(([uid]) => uid === 'k-1')?.[1];
  assert.ok(k1?.form === 'karambit' && k1?.f === 'knife_emerald', `kept as ${JSON.stringify(k1)}`);
  ok('a knife takes any knife finish; one made a karambit is one wherever it is read in, its finish kept; a claimed one is the knife');
}

// ---- the real server
const PORT = 8311, SITE = 8312;
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const acctOf = (key: string) => createHash('sha256').update(ACCT_SALT + key).digest('hex').slice(0, 24);

const files = new Map<string, { text: string; mark: number }>();
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
    files.set(p, { text: JSON.stringify(data), mark: (f?.mark ?? 0) + 1 });
    return String((f?.mark ?? 0) + 1);
  },
  async list() {
    return [...files.keys()];
  },
};
let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  constructor(public name: string, public key = `plates-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
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
  async wait<T extends S2C['t']>(t: T, ok: (m: Extract<S2C, { t: T }>) => boolean = () => true, ms = 4000) {
    for (let k = 0; k < ms / 50; k++) {
      const m = this.got.find((x) => x.t === t && ok(x as Extract<S2C, { t: T }>));
      if (m) return m as Extract<S2C, { t: T }>;
      await sleep(50);
    }
    return undefined;
  }
}
const ann = new Player('Ann'), bob = new Player('Bob');
// (Ann bought the gold Desert Eagle; Bob bought nothing)
const perkList: PerkList = { at: Date.now(), who: { [acctOf(ann.key)]: [0, 0, 0, ['deagle_gold']] } };
const site = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${SITE}`);
  if (url.pathname === '/api/store') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(perkList));
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(url, { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) });
  const env = { ADMIN_PASSWORD: PASSWORD };
  const out = url.pathname === '/api/admin' ? await admin(request, store, `http://127.0.0.1:${PORT}`, env) : url.pathname === '/api/keep' ? await keep(request, store, env) : new Response('not here', { status: 404 });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(await out.text());
});
await new Promise<void>((done) => site.listen(SITE, '127.0.0.1', done));

async function withServer(play: (log: () => string) => Promise<void>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-plates-'));
  const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: `http://127.0.0.1:${SITE}`, STORE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'on', KEEP_EVERY_MIN: '0.04', KEEP_WAIT_S: '3' },
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

const vitals = { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false };
const deagle = (uid: string, extra: Partial<ItemInstance> = {}) => ({ uid, id: 'deagle', qty: 1, loaded: 0, mag: null, ...extra });
const world = generateWorld();
const at: [number, number, number] = [40, heightAt(world.heights, 40, 40), 40];

await withServer(async (log) => {
  assert.ok(await ann.join(), `Ann was not let in:\n${log().slice(-500)}`);
  assert.ok(await bob.join(), 'Bob was not let in');
  const y = at[1];
  for (const p of [ann, bob]) p.send({ t: 's', p: [at[0], y, at[2], 0, 0, 0], w: null, m: [] });
  // (the perk list is read as the server starts: she is told her own once it has been)
  assert.ok(await ann.wait('perks', (m) => m.id === ann.id && m.sk.includes('deagle_gold'), 8000), 'Ann was never told she owns the gold finish');

  // Bob owns no finish: his Apply is refused, and a gun his game says is gold is not
  bob.send({ t: 'me', inv: { slots: { holster: deagle('bob-forged', { finish: 'deagle_gold' }) }, active: 'holster', containers: [] }, vitals });
  bob.send({ t: 'finish', uid: 'bob-forged' });
  assert.ok(await bob.wait('tell', (m) => /no finish/.test(m.text)), 'Bob was not told he has no finish');
  assert.ok(!bob.got.some((m) => m.t === 'finish'), 'Bob, who bought nothing, plated a gun');
  ok('somebody who owns no finish is refused, and a finish their game claims is not shown to anybody');

  // Ann plates her Desert Eagle, and one more in her pocket
  ann.send({ t: 'me', inv: { slots: { holster: deagle('ann-1') }, active: 'holster', containers: [{ id: 'pockets', items: [{ ...deagle('ann-2'), x: 0, y: 0, rot: false }] }] }, vitals });
  ann.send({ t: 'finish', uid: 'ann-1' });
  ann.send({ t: 'finish', uid: 'ann-2' });
  const f1 = await ann.wait('finish', (m) => m.uid === 'ann-1'), f2 = await ann.wait('finish', (m) => m.uid === 'ann-2');
  assert.ok(f1 && f1.f === 'deagle_gold', `her gun was not plated: ${JSON.stringify(f1)}`);
  assert.ok(f2 && f2.f === 'deagle_gold', 'her second gun was not plated');
  // (held, it is gold to Bob)
  ann.send({ t: 's', p: [at[0], y, at[2], 0, 0, 0], w: 'deagle', m: [], u: 'ann-1' });
  assert.ok(await bob.wait('ps', (m) => m.s.some((r) => r[0] === ann.id && r[7] === 'deagle' && r[10] === 'gold')), 'Bob does not see the gun in her hands as gold');
  ok('the buyer plates her gun and a second of the same kind, and others see it gold in her hands');

  // she drops it; Bob picks it up, his game saying nothing of a finish: it is gold in his hands
  bob.got = [];
  ann.send({ t: 'me', inv: { slots: { holster: null }, active: null, containers: [{ id: 'pockets', items: [{ ...deagle('ann-2'), x: 0, y: 0, rot: false }] }] }, vitals });
  ann.send({ t: 'drop', l: { item: deagle('ann-1'), x: at[0] + 1, y, z: at[2], rot: 0 } });
  const lies = await bob.wait('loot+', (m) => m.l.uid === 'ann-1');
  assert.ok(lies && lies.l.item.finish === 'deagle_gold', `the gun she dropped lies there plain: ${JSON.stringify(lies?.l.item)}`);
  bob.send({ t: 'take', uid: 'ann-1' });
  await sleep(300);
  assert.ok(!bob.got.some((m) => m.t === 'denied'), 'Bob could not pick it up');
  bob.send({ t: 'me', inv: { slots: { holster: deagle('ann-1') }, active: 'holster', containers: [{ id: 'pockets', items: [{ ...deagle('bob-forged', { finish: 'deagle_gold' }), x: 0, y: 0, rot: false }] }] }, vitals });
  ann.got = [];
  // (his game says which gun is in his hands: the forged one shows plain, the looted one gold)
  bob.send({ t: 's', p: [at[0], y, at[2], 0, 0, 0], w: 'deagle', m: [], u: 'bob-forged' });
  await sleep(300);
  assert.ok(!ann.got.some((m) => m.t === 'ps' && m.s.some((r) => r[0] === bob.id && r[10])), 'the gun Bob said was gold is gold in his hands');
  bob.send({ t: 's', p: [at[0], y, at[2], 0, 0, 0], w: 'deagle', m: [], u: 'ann-1' });
  assert.ok(await ann.wait('ps', (m) => m.s.some((r) => r[0] === bob.id && r[10] === 'gold')), 'the gun Bob looted is not gold in his hands');
  ok('dropped, it lies there gold; looted, it is gold in the hands of whoever took it');

  // (written to the site as time goes by)
  const was = log().length;
  for (let k = 0; k < 120 && !/time has gone by: 2 characters/.test(log().slice(was)); k++) await sleep(100);
  assert.ok(/time has gone by: 2 characters/.test(log().slice(was)), `nothing was written to the site:\n${log().slice(-600)}`);
});

// ---- stopped dead and started again: each gun is as it was
await withServer(async (log) => {
  assert.ok(await bob.join(), `Bob was not let in after the restart:\n${log().slice(-500)}`);
  const inv = bob.last('welcome')!.me!.inv;
  const held = inv.slots.holster as ItemInstance, forged = inv.containers.find((c) => c.id === 'pockets')!.items.find((i) => i.uid === 'bob-forged');
  assert.ok(held?.uid === 'ann-1' && held.finish === 'deagle_gold', `the gun Bob looted lost its finish over the restart: ${JSON.stringify(held)}`);
  assert.ok(forged && !forged.finish, 'the gun Bob said was gold is gold after the restart');
  assert.ok(await ann.join());
  const hers = ann.last('welcome')!.me!.inv.containers.find((c) => c.id === 'pockets')!.items.find((i) => i.uid === 'ann-2');
  assert.equal(hers?.finish, 'deagle_gold', 'her second gun lost its finish over the restart');
  ok('through a restart: the looted gun and her own are gold still, and the one claimed is not');
});

site.close();
console.log(`\n${checks} checks passed`);
process.exit(0);
