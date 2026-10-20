// Dog tags through a restart, every place one can be (the owner, 2026-10-19: "users complain they lose their dog tags
// during server restart"): the tag round a survivor's own neck stays round it, its time served kept (it began again at
// every coming back, and the tag went with it); a tag taken off somebody is still known after it and its hold time goes
// on where it stood; and a tag lying on a body is on the body laid out again, and pays once carried for its time. The
// real server, stopped as a host stops it (its last word written) and started again, then stopped dead and started
// once more. A stand-in for the site on this machine (as test/tag-keep.test.ts); the cash-in is reported to a path it
// does not answer. Nothing is paid.
//   npx tsx test/tag-restart.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { admin } from '../api/admin';
import { keep } from '../api/keep';
import type { Store } from '../api/_lib/store';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';
import { inPlay } from '../src/world/worldgen/layout';

const PORT = 8293, SITE = 8294, HOLD = 4, FRESH = 2;
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
// (where it all happens: inside the Zona, where a life's time counts toward its own tag)
const AT = 30;
assert.ok(inPlay(AT, 0), 'the test ground is not inside the Zona');

// ---- the site, standing here: its files in a variable
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
const site = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${SITE}`);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(url, { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) });
  const env = { ADMIN_PASSWORD: PASSWORD };
  const out = url.pathname === '/api/admin' ? await admin(request, store, `http://127.0.0.1:${PORT}`, env) : url.pathname === '/api/keep' ? await keep(request, store, env) : new Response('not here', { status: 404 });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(await out.text());
});
await new Promise<void>((done) => site.listen(SITE, '127.0.0.1', done));

type Tag = { uid: string; owner: string };
type Welcome = Extract<S2C, { t: 'welcome' }>;
let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  welcome: Welcome | null = null;
  x = AT;
  constructor(public name: string, public key = `tag-restart-key-${name}-${String(++n).padStart(20, '0')}`) {}
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
    this.welcome = (this.got.find((m) => m.t === 'welcome') as Welcome | undefined) ?? null;
    if (!this.welcome) return false;
    this.id = this.welcome.you;
    return true;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  say(x = this.x, w: string | null = null) {
    this.x = x;
    this.send({ t: 's', p: [x, ground(x, 0), 0, 0, 0, 0], w, m: [] });
  }
  /** `neck` round their neck and `tags` in the pouch, and nothing else */
  carry(tags: Tag[], neck: Tag | null = null) {
    const item = (t: Tag) => ({ ...t, id: 'dogtag', qty: 1 });
    this.send({ t: 'me', inv: { slots: neck ? { neck: item(neck) } : {}, active: null, containers: [{ id: 'tags', items: tags.map((t, i) => ({ ...item(t), x: i, y: 0, rot: false })) }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
}

async function withServer(how: 'word' | 'dead', play: (log: () => string) => Promise<void>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-tag-restart-'));
  const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'on', KEEP_EVERY_MIN: '0.04', KEEP_WAIT_S: '3', TAG_FRESH_S: String(FRESH), TAG_MIN_LIFE_S: '1', FRESH_S: '0.2', CASH_HOLD_S: String(HOLD), STOP_BY_WORD: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let logged = '';
  server.stdout!.on('data', (d) => (logged += d));
  server.stderr!.on('data', (d) => (logged += d));
  let failed: unknown = null;
  try {
    for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
    assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
    await play(() => logged);
  } catch (e) {
    failed = e;
  } finally {
    if (how === 'word' && !failed) {
      server.stdin!.write('stop');
      for (let k = 0; k < 200 && server.exitCode === null; k++) await sleep(100);
      if (!/\[keep\] this server is stopping: .*written/.test(logged)) failed = new Error(`no last word was written as the server stopped:\n${logged.slice(-600)}`);
    }
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

/** everybody here says where they are for `ms`, as a game does every moment: time in the Zona is counted at each word */
async function live(ps: Player[], ms: number) {
  for (let t = 0; t < ms; t += 400) {
    for (const p of ps) p.say();
    await sleep(400);
  }
}

/** Ann shoots `who` dead where they stand */
async function shoot(log: () => string, ann: Player, who: Player) {
  const mark = log().length;
  ann.say(AT - 1, 'mosin');
  for (let k = 0; k < 8 && !log().slice(mark).includes(`${who.name} was killed`); k++) {
    ann.send({ t: 'hit', to: who.id, w: 'mosin', zone: 'torso' });
    await sleep(900);
  }
  assert.ok(log().slice(mark).includes(`${who.name} was killed`), `${who.name} was not shot dead:\n${log().slice(-800)}`);
  assert.ok(!log().slice(mark).includes(`${who.name} left no dog tag`), `${who.name} left no dog tag:\n${log().slice(-800)}`);
}

/** what lies on `name`'s body, as whoever opens it is told */
async function onBody(p: Player, name: string): Promise<{ uid: string }[]> {
  const at = p.got.length;
  const kept = p.welcome?.corpses.find((b) => b.name === name);
  const fresh = p.got.map((m) => (m.t === 'death' || m.t === 'corpse@' ? m.corpse : null)).find((b) => b?.name === name);
  const cid = (fresh ?? kept)?.uid;
  assert.ok(cid, `${p.name} sees no body of ${name}`);
  p.say(AT);
  await sleep(200);
  p.send({ t: 'copen', cid });
  for (let k = 0; k < 40 && !p.got.slice(at).some((m) => m.t === 'cdata'); k++) await sleep(100);
  const d = p.got.slice(at).find((m) => m.t === 'cdata') as { items: { uid: string }[] } | undefined;
  assert.ok(d, `${p.name} could not open ${name}'s body`);
  p.send({ t: 'cclose', cid });
  return d.items;
}

/** what the log says of Eli cashing a tag in */
async function cash(log: () => string, eli: Player, tag: Tag) {
  eli.send({ t: 'cash', uid: tag.uid, wallet: '' });
  for (let k = 0; k < 40 && !log().includes(`Eli cashed in ${tag.owner}'s dog tag`); k++) await sleep(100);
  const line = log().split('\n').find((l) => l.includes(`Eli cashed in ${tag.owner}'s dog tag`)) ?? '';
  assert.ok(line, `the tag could not be cashed in:\n${log().slice(-800)}`);
  return line;
}

let checks = 0;
const ann = new Player('Ann'), bo = new Player('Bo'), dan = new Player('Dan'), eli = new Player('Eli'), gil = new Player('Gil');
const bos: Tag = { uid: 'own-Bo', owner: 'Bo' }, dans: Tag = { uid: 'own-Dan', owner: 'Dan' }, gils: Tag = { uid: 'own-Gil', owner: 'Gil' };
// (two more from the same machine, so that one connection is not taken for one player: see ipsTellApart)
const others = () => [new Player(`Fay${n}`), new Player(`Hal${n}`)];

// ---- 1: Bo lives his time and wears his tag; Dan and Gil are shot dead, Eli carries Dan's for most of its hold, Gil's lies on his body
let carriedFor = 0;
await withServer('word', async (log) => {
  for (const p of [ann, bo, dan, eli, gil, ...others()]) assert.ok(await p.join(), `${p.name} was not let in:\n${log().slice(-500)}`);
  await live([ann, bo, dan, eli, gil], FRESH * 1000 + 1200);
  bo.carry([], bos);
  dan.carry([], dans);
  gil.carry([], gils);
  await sleep(300);
  await shoot(log, ann, dan);
  await shoot(log, ann, gil);
  const began = Date.now();
  eli.carry([dans]);
  await live([ann, bo, eli], HOLD * 1000 - 1400);
  carriedFor = Date.now() - began;
  bo.carry([], bos);
  await sleep(300);
  checks++;
  console.log(`  ok  Bo wears his own tag, Dan's is carried ${(carriedFor / 1000).toFixed(1)} s of its ${HOLD}, Gil's lies on his body: stopped as a host stops it`);
});

// ---- 2: started again from its last word
await withServer('dead', async (log) => {
  for (const p of [eli, bo, ann, ...others()]) assert.ok(await p.join(), `${p.name} was not let in after the restart:
${log().slice(-500)}`);
  // Dan's tag: Eli still has it, it is known, and the time he held it before the restart counts
  assert.ok(JSON.stringify(eli.welcome?.me?.inv ?? null).includes(dans.uid), "Dan's tag is not in Eli's pockets after the restart");
  const back = Date.now();
  eli.carry([dans]);
  await live([eli, bo, ann], HOLD * 1000 - carriedFor + 600);
  const line = await cash(log, eli, dans);
  const after = Date.now() - back;
  assert.ok(!line.includes('not listed for a reward'), `Dan's tag was cashed in for nothing after the restart: ${line}`);
  assert.ok(after < HOLD * 1000, `its hold began again: cashed ${after} ms after the restart`);
  checks++;
  console.log(`  ok  Dan's tag, carried through the restart, is cashed in ${(after / 1000).toFixed(1)} s after it (of ${HOLD}) and listed for its reward`);
  // Bo's own tag: still round his neck, with his time served, and his game told so
  const me = bo.welcome?.me;
  assert.ok(me, 'Bo came back as a new life');
  assert.equal((me.inv.slots as Record<string, { uid?: string } | null>).neck?.uid, bos.uid, 'Bo came back without his tag round his neck');
  assert.ok((me.tag ?? 0) >= FRESH * 1000, `Bo's time toward his own tag began again: ${me.tag ?? 'not said'} ms`);
  checks++;
  console.log(`  ok  Bo comes back with his tag round his neck and ${((me.tag ?? 0) / 1000).toFixed(1)} s served (his game keeps it on)`);
  // his game says it is round his neck as it was; he is shot dead, and it is on his body
  bo.carry([], bos);
  await sleep(300);
  await shoot(log, ann, bo);
  assert.ok((await onBody(ann, 'Bo')).some((i) => i.uid === bos.uid), "Bo's tag is not on his body");
  checks++;
  console.log('  ok  shot dead after the restart, his tag is on his body for the taking');
  // Gil's tag: on his body, laid out again; taken off it and carried its time, it pays: whose it was outlived the restart
  assert.ok((await onBody(ann, 'Gil')).some((i) => i.uid === gils.uid), "Gil's tag is not on his body after the restart");
  eli.carry([gils]);
  await live([eli, ann], HOLD * 1000 + 600);
  const gline = await cash(log, eli, gils);
  assert.ok(!gline.includes('not listed for a reward'), `Gil's tag was cashed in for nothing: ${gline}`);
  checks++;
  console.log("  ok  Gil's body is laid out again with his tag on it, and the tag, carried its time, is listed for its reward");
  // and the world is written once more with Eli on, his own time served: then the server dies
  const mark = log().length;
  for (let k = 0; k < 40 && !/time has gone by/.test(log().slice(mark)); k++) await live([eli, ann], 400);
  assert.ok(/time has gone by/.test(log().slice(mark)), `nothing was written before the server died:
${log().slice(-600)}`);
});

// ---- 3: started again from what was written before it died: the time toward a tag of one's own is kept all the same
await withServer('dead', async (log) => {
  for (const p of [eli, ...others()]) assert.ok(await p.join(), `${p.name} was not let in after the server died:
${log().slice(-500)}`);
  const me = eli.welcome?.me;
  assert.ok(me, `Eli came back as a new life after the server died:
${log().slice(-500)}`);
  assert.ok((me.tag ?? 0) >= FRESH * 1000, `after a server that died, Eli's time toward his own tag began again: ${me.tag ?? 'not said'} ms`);
  checks++;
  console.log(`  ok  after a server that died, Eli comes back with ${((me.tag ?? 0) / 1000).toFixed(1)} s served toward his own tag`);
});

site.close();
console.log(`\n${checks} checks passed`);
process.exit(0);
