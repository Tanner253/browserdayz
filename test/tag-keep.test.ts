// A dog tag carried through a restart still pays (the owner, 2026-10-18: "when the server restarts, player sshould not
// lose their dogtags, its bad UX its not their fault"): whose it was and when its carrier picked it up are kept with
// the world (server/tags.ts keepTags), and the time held before the restart counts. Only through a last word, written
// as the server stops: a server stopped dead comes back from an older copy, whose pockets may hold a tag cashed and
// paid since, and a tag through that pays nothing (and is never paid twice). The real server, started, stopped and
// started again, with a stand-in for the site on this machine (as test/keep.test.ts). Nothing is paid.
//   npx tsx test/tag-keep.test.ts

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
import { TAG_HOLD } from '../src/sim/items';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8261, SITE = 8262, HOLD = 2;
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

// ---- the site, standing here: its files in a variable (the cash-in itself is reported to a path it does not answer)
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

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  constructor(public name: string, public key = `tag-keep-key-${name}-${String(++n).padStart(20, '0')}`) {}
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
  say(x: number, z: number, w: string | null = null) {
    this.send({ t: 's', p: [x, ground(x, z), z, 0, 0, 0], w, m: [] });
  }
  /** a tag taken off a body as a game takes it: the body opened, and set again without it (the server keeps who holds each tag that can pay, server/custody.ts: a game's word that it carries one is not enough) */
  async takeOff(cid: string, uid: string) {
    const at = this.got.length;
    this.send({ t: 'copen', cid });
    for (let k = 0; k < 60 && !this.got.slice(at).some((m) => m.t === 'cdata' && m.cid === cid); k++) await sleep(50);
    const d = this.got.slice(at).find((m) => m.t === 'cdata' && m.cid === cid) as Extract<S2C, { t: 'cdata' }> | undefined;
    assert.ok(d?.items.some((it) => it.uid === uid), `${this.name} found no tag ${uid} on the body`);
    this.send({ t: 'cset', cid, items: d!.items.filter((it) => it.uid !== uid) });
    this.send({ t: 'cclose', cid });
    await sleep(150);
  }
  /** the body of the player numbered `id`, as this player was told of their death */
  bodyOf(id: number): string {
    const d = this.got.find((m) => m.t === 'death' && m.k.id === id) as Extract<S2C, { t: 'death' }> | undefined;
    assert.ok(d?.corpse, `${this.name} was told of no body of #${id}`);
    return d!.corpse!.uid;
  }
  /** these tags on them, and nothing else */
  carry(tags: { uid: string; owner: string; held?: number }[]) {
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'tags', items: tags.map((t, i) => ({ ...t, id: 'dogtag', qty: 1, x: i, y: 0, rot: false })) }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
}

/** `how` the server is stopped at the end: by a word on its input, as a host stops it (its last word is written), or dead */
async function withServer(how: 'word' | 'dead', play: (log: () => string) => Promise<void>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-tag-keep-'));
  const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'on', KEEP_EVERY_MIN: '0.04', KEEP_WAIT_S: '3', TAG_FRESH_S: '1', TAG_MIN_LIFE_S: '1', FRESH_S: '0.2', CASH_HOLD_S: String(HOLD), STOP_BY_WORD: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
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
    if (how === 'word' && !failed) {
      server.stdin!.write('stop');
      for (let k = 0; k < 200 && server.exitCode === null; k++) await sleep(100);
      if (!/\[keep\] this server is stopping: .*written/.test(logged)) failed = new Error(`no last word was written as the server stopped:\n${logged.slice(-600)}`);
    }
    // (stopped dead, or what is left of it: no last word is said)
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
const ann = new Player('Ann'), dan = new Player('Dan'), eli = new Player('Eli'), gil = new Player('Gil');
const dans = { uid: 'own-Dan', owner: 'Dan' }, gils = { uid: 'own-Gil', owner: 'Gil' };

/** Ann shoots `who` dead with their tag on them, and Eli carries it (with `also`) for its time */
async function looted(log: () => string, who: Player, tag: { uid: string; owner: string }, also: { uid: string; owner: string }[] = []) {
  // (each says where they are as a game does, every moment: a life's time toward its tag is counted inside the Zona at each word)
  for (let t = 0; t < 2000; t += 400) {
    ann.say(30, 0, 'mosin');
    who.say(31, 0);
    eli.say(34, 0);
    await sleep(400);
  }
  who.carry([tag]);
  await sleep(300);
  for (let k = 0; k < 8 && !log().includes(`${who.name} was killed`); k++) {
    ann.send({ t: 'hit', to: who.id, w: 'mosin', zone: 'torso' });
    await sleep(900);
  }
  assert.ok(log().includes(`${who.name} was killed`) && !log().includes(`${who.name} left no dog tag`), `${who.name} was not shot dead with their tag on them:\n${log().slice(-800)}`);
  await eli.takeOff(eli.bodyOf(who.id), tag.uid);
  eli.carry([...also, tag]);
  await sleep(HOLD * 1000 + 800);
  const mark = log().length;
  for (let k = 0; k < 80 && !/time has gone by/.test(log().slice(mark)); k++) await sleep(100);
  assert.ok(/time has gone by/.test(log().slice(mark)), `nothing was written to the site after he had carried it:\n${log().slice(-600)}`);
}

/** Eli, back in, cashes a tag in: what the log says of it */
async function cashed(log: () => string, tag: { uid: string; owner: string }) {
  eli.send({ t: 'cash', uid: tag.uid, wallet: '' });
  for (let k = 0; k < 40 && !log().includes(`cashed in ${tag.owner}'s dog tag`); k++) await sleep(100);
  const line = log().split('\n').find((l) => l.includes(`Eli cashed in ${tag.owner}'s dog tag`)) ?? '';
  assert.ok(line, `the tag could not be cashed in after the restart:\n${log().slice(-800)}`);
  return line;
}

// ---- Ann shoots Dan dead, Eli carries his tag for its time, and the server is stopped as a host stops it
await withServer('word', async (log) => {
  for (const p of [ann, dan, eli]) assert.ok(await p.join(), `${p.name} was not let in:\n${log().slice(-500)}`);
  await looted(log, dan, dans);
  checks++;
  console.log('  ok  a tag taken off a man shot dead is carried for its time, and the world is written to the site');
});

// ---- started again: Eli cashes it in, and it is listed for its reward; then he carries Gil's, and the server dies
await withServer('dead', async (log) => {
  assert.ok(await eli.join(), `Eli was not let in after the restart:\n${log().slice(-500)}`);
  // (two more in from the same machine, so that one connection is not taken for one player: see ipsTellApart)
  for (const p of [new Player('Fay'), new Player('Hal')]) assert.ok(await p.join());
  const line = await cashed(log, dans);
  assert.ok(!line.includes('not listed for a reward'), `the tag was cashed in for nothing after the restart: ${line}`);
  checks++;
  console.log('  ok  after the server is stopped and started again, the tag he carried is cashed in and listed for its reward');
  for (const p of [ann, gil]) assert.ok(await p.join());
  await looted(log, gil, gils);
});

// ---- started again from what was written before it died: Gil's tag is carried for nothing, and so never paid twice
await withServer('dead', async (log) => {
  assert.ok(await eli.join(), `Eli was not let in after the second restart:\n${log().slice(-500)}`);
  for (const p of [new Player('Ivy'), new Player('Jon')]) assert.ok(await p.join());
  // (his game has counted the time he carried it, as any game does: what the server goes by for a tag it knows nothing of)
  eli.carry([{ ...gils, held: TAG_HOLD }]);
  await sleep(400);
  const line = await cashed(log, gils);
  assert.ok(line.includes('the server restarted while you were carrying it'), `a tag carried through a server that died paid all the same: ${line}`);
  checks++;
  console.log('  ok  a server that dies is followed by one that knows nothing of the tags it held: they pay nothing, and none is paid twice');
});

site.close();
console.log(`\n${checks} checks passed`);
process.exit(0);
