// A dog tag carried through a restart still pays (the owner, 2026-10-18: "when the server restarts, player sshould not
// lose their dogtags, its bad UX its not their fault"): whose it was and when its carrier picked it up are kept with
// the world (server/tags.ts keepTags), and the time held before the restart counts. The real server, started, stopped
// dead and started again, with a stand-in for the site on this machine (as test/keep.test.ts). Nothing is paid.
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
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8253, SITE = 8254, HOLD = 2;
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
  /** these tags on them, and nothing else */
  carry(tags: { uid: string; owner: string }[]) {
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'tags', items: tags.map((t, i) => ({ ...t, id: 'dogtag', qty: 1, x: i, y: 0, rot: false })) }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
}

async function withServer(play: (log: () => string) => Promise<void>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-tag-keep-'));
  const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'on', KEEP_EVERY_MIN: '0.04', KEEP_WAIT_S: '3', TAG_FRESH_S: '1', TAG_MIN_LIFE_S: '1', FRESH_S: '0.2', CASH_HOLD_S: String(HOLD) },
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
const ann = new Player('Ann'), dan = new Player('Dan'), eli = new Player('Eli');
const dans = { uid: 'own-Dan', owner: 'Dan' };

// ---- Ann shoots Dan dead, Eli carries his tag for its time, and what is kept is written
await withServer(async (log) => {
  for (const p of [ann, dan, eli]) assert.ok(await p.join(), `${p.name} was not let in:\n${log().slice(-500)}`);
  ann.say(30, 0, 'mosin');
  dan.say(31, 0);
  eli.say(34, 0);
  await sleep(1500);
  dan.carry([dans]);
  await sleep(300);
  for (let k = 0; k < 8 && !log().includes('Dan was killed'); k++) {
    ann.send({ t: 'hit', to: dan.id, w: 'mosin', zone: 'torso' });
    await sleep(900);
  }
  assert.ok(log().includes('Dan was killed') && !log().includes('Dan left no dog tag'), `Dan was not shot dead with his tag on him:\n${log().slice(-800)}`);
  eli.carry([dans]);
  await sleep(HOLD * 1000 + 800);
  const mark = log().length;
  for (let k = 0; k < 80 && !/time has gone by/.test(log().slice(mark)); k++) await sleep(100);
  assert.ok(/time has gone by/.test(log().slice(mark)), `nothing was written to the site after he had carried it:\n${log().slice(-600)}`);
  checks++;
  console.log('  ok  a tag taken off a man shot dead is carried for its time, and the world is written to the site');
});

// ---- started again: Eli, back in, cashes it in, and it is listed for its reward
await withServer(async (log) => {
  assert.ok(await eli.join(), `Eli was not let in after the restart:\n${log().slice(-500)}`);
  // (two more in from the same machine, so that one connection is not taken for one player: see ipsTellApart)
  for (const p of [new Player('Fay'), new Player('Gus')]) assert.ok(await p.join());
  eli.send({ t: 'cash', uid: dans.uid, wallet: '' });
  for (let k = 0; k < 40 && !log().includes("cashed in Dan's dog tag"); k++) await sleep(100);
  const line = log().split('\n').find((l) => l.includes("Eli cashed in Dan's dog tag")) ?? '';
  assert.ok(line, `the tag could not be cashed in after the restart:\n${log().slice(-800)}`);
  assert.ok(!line.includes('not listed for a reward'), `the tag was cashed in for nothing after the restart: ${line}`);
  checks++;
  console.log('  ok  after the server is stopped dead and started again, the tag he carried is cashed in and listed for its reward');
});

site.close();
console.log(`\n${checks} checks passed`);
process.exit(0);
