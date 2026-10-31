// A deploy, as the host does one (server/index.ts: `reachedHere`, `loadKept`, RESTART): the server that is to take
// over is started while the one before it is still the one players reach, and only later is the address handed
// over and the old one told to stop. What has to hold, and did not on the night of 2026-10-11:
//   - the old server finds out by itself that something newer has been published, and says so to everybody on,
//     with why;
//   - the new one lets nobody in, and reads nothing, for as long as the old one is the one being reached, however
//     long that is (forty seconds here: it used to give up after thirty-five and open with nothing kept);
//   - when the address is handed over, the old one sees for itself that it has been replaced: without being told
//     to stop (the host tells it a whole minute later) it says so to whoever is on, writes its last word and goes;
//   - the new one then has everybody as they were at that last word, not as they were when the old one last
//     happened to write;
//   - and when a server stops WITHOUT a last word (2026-10-13: it happened on the host, and everybody came back
//     as they had been 68 minutes before), what the next one has is what was written when the deploy was
//     announced to it, a moment before: told a deploy is coming by whoever can push, a server writes everything
//     first; told so by anybody else, it writes nothing.
// Two real game servers on this machine, a stand-in for the site (the real api/admin and api/keep over a store that
// is a variable), a stand-in for the address the world reaches the server at, and one for where the code is
// published. Nothing here touches the real site, its store, or the real host. About a minute and a half.
//   npx tsx test/handover.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { admin } from '../api/admin';
import { keep, type Kept } from '../api/keep';
import type { Store } from '../api/_lib/store';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { generateWorld, heightAt } from '../src/world/worldgen';

const A = 8171, B = 8172, SITE = 8173, PUB = 8174, GIT = 8175, C = 8176;
// (a password made up here, for this test's stand-in site and nothing else)
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

// ---- the site
const files = new Map<string, { text: string; mark: number }>();
// (The real store, for a while after a file is written, cannot be read at all: it knows the file has changed and
// its cache serves the copy before. On 2026-10-13 that was a hundred seconds, right after the last word was
// written, and the new server gave up. Here: so many ms after every writing, while `lag` is set.)
let lag = 0, wroteAt = 0;
const store: Store = {
  async read<T>(p: string) {
    if (lag && p === 'zona/world.json' && Date.now() - wroteAt < lag) throw new Error('the file store is serving an old copy');
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
    if (p === 'zona/world.json') wroteAt = Date.now();
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
  // (the site reaches the game server where the world does: at the public address, whichever server that is)
  const out = url.pathname === '/api/admin' ? await admin(request, store, `http://127.0.0.1:${PUB}`, env) : url.pathname === '/api/keep' ? await keep(request, store, env) : new Response('not here', { status: 404 });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(await out.text());
});
// ---- the address the world reaches the server at: one of the two, and then the other
let reached = A;
const pub = http.createServer((req, res) => {
  const to = http.request({ hostname: '127.0.0.1', port: reached, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  to.on('error', () => res.writeHead(502).end());
  req.pipe(to);
});
// ---- where the code is published: the newest commit, and the note that came with it
let newest = 'aaaaaaa1', deployingAt = '';
const git = http.createServer((req, res) => {
  if (req.url === '/head') return void res.writeHead(200, { 'content-type': 'text/plain' }).end(newest);
  if (req.url === '/branch/deploying') return void res.writeHead(deployingAt ? 200 : 404, { 'content-type': 'text/plain' }).end(deployingAt);
  if (req.url === `/note/bbbbbbb2`) return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ why: 'update: buildings' }));
  res.writeHead(404).end();
});
for (const [s, p] of [[site, SITE], [pub, PUB], [git, GIT]] as [http.Server, number][]) await new Promise<void>((done) => s.listen(p, '127.0.0.1', done));
const kept = () => (files.has('zona/world.json') ? (JSON.parse(files.get('zona/world.json')!.text) as Kept) : null);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  shut = false;
  constructor(public name: string, public key = `handover-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
  /** @returns whether they were let in within `wait` ms (they stay connected, in the line, if not) */
  async join(port: number, wait = 20_000): Promise<boolean> {
    this.got = [];
    this.shut = false;
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    return this.in(wait);
  }
  async in(wait: number) {
    for (let k = 0; k < wait / 50 && !this.shut && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    return this.got.some((m) => m.t === 'welcome');
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  last<T extends S2C['t']>(t: T) {
    return this.got.filter((m) => m.t === t).pop() as Extract<S2C, { t: T }> | undefined;
  }
}

const dirs: string[] = [];
function start(port: number, commit: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-handover-'));
  dirs.push(dir);
  const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: {
      ...process.env, PORT: String(port), SITE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0',
      // (it writes when somebody first comes in and when it is told to stop, and at no other time: as on the host, near enough)
      KEEP: 'on', KEEP_EVERY_MIN: '600', KEEP_WAIT_S: '3', OTHER_URL: `http://127.0.0.1:${PUB}`, STOP_BY_WORD: '1', REPLACED_EVERY_MS: '1000',
      WATCH_URL: `http://127.0.0.1:${GIT}`, WATCH_MINE: commit, RESTART_WATCH_S: '2', RESTART_ABOUT_S: '40',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const out = { server, log: '' };
  server.stdout!.on('data', (d) => (out.log += d));
  server.stderr!.on('data', (d) => (out.log += d));
  return out;
}
const up = async (s: { log: string }) => {
  for (let k = 0; k < 1800 && !s.log.includes('listening'); k++) await sleep(100);
  assert.ok(s.log.includes('listening'), `a server did not start:\n${s.log.slice(-600)}`);
};

let checks = 0, failed: unknown = null;
const ann = new Player('Ann'), bob = new Player('Bob');
const at: [number, number] = [-120, 300];
const pose = (w: string | null = null) => ({ t: 's', p: [at[0], ground(...at), at[1], 1.25, 0, 0], w, m: [] });
const me = (health: number, tins: number) => ({ t: 'me', inv: { slots: { primary: { uid: 'handover-test-rifle', id: 'ak', qty: 1, loaded: 0, mag: null } }, active: null, containers: [{ id: 'jacket', items: Array.from({ length: tins }, (_, k) => ({ uid: `handover-test-tin-${k}`, id: 'beans', qty: 1, x: k, y: 0, rot: false })) }] }, vitals: { health, energy: 50, water: 40, stamina: 300, bleeding: false } });
const old = start(A, 'aaaaaaa1');
let young: ReturnType<typeof start> | null = null, third: ReturnType<typeof start> | null = null;
try {
  await up(old);
  assert.ok(await ann.join(A), `nobody was let into the first server:\n${old.log.slice(-500)}`);
  ann.send(pose());
  ann.send(me(64, 0));
  for (let k = 0; k < 100 && !/somebody is on: \d+ characters/.test(old.log); k++) await sleep(100);
  assert.ok(/somebody is on: \d+ characters/.test(old.log), `the first server wrote nothing when somebody came in:\n${old.log.slice(-500)}`);
  // (and then she goes on playing: this is not written anywhere until the server says its last word)
  ann.send(me(41, 1));
  await sleep(300);
  // (and a heart is given to an entry of the changelog, and something said under it: neither is written anywhere
  // until then either)
  const entry = /<article class="entry" id="([a-z0-9-]+)"/.exec(readFileSync('public/changelog/index.html', 'utf8'))![1], mark = 'c'.repeat(32);
  const told = async (port: number, at: string, body: unknown) => (await (await fetch(`http://127.0.0.1:${port}${at}`, { method: 'POST', body: JSON.stringify(body) })).json()) as { ok: boolean };
  assert.ok((await told(A, '/news/heart', { entry, by: mark })).ok, 'a heart was not taken');
  assert.ok((await told(A, '/news/comment', { entry, by: mark, name: 'Ann', text: 'kept through the restart' })).ok, 'a comment was not taken');

  // ---- something newer is published: the server sees it by itself, and says so, with why
  newest = 'bbbbbbb2';
  for (let k = 0; k < 80 && !ann.last('restart'); k++) await sleep(100);
  const said = ann.last('restart');
  assert.ok(said, `nobody was told a restart is coming:\n${old.log.slice(-400)}`);
  assert.equal(said.why, 'update: buildings', 'it was not said why');
  assert.ok(said.in > 20 && said.in <= 40, `it was said to be ${said.in} s away`);
  // (and whoever comes in after that is told as well)
  const cat = new Player('Cat');
  assert.ok(await cat.join(A));
  await sleep(300);
  assert.equal(cat.last('restart')?.why, 'update: buildings', 'somebody who came in after it was said was not told');
  cat.ws.close();
  checks++;
  console.log('  ok  a server sees for itself that something newer is published, and says so to everybody on, and why');

  // ---- the new server is started while the old one is still the one being reached: it lets nobody in
  young = start(B, 'bbbbbbb2');
  // (her game keeps sending where she stands, as a game does: the map three times over takes the new server longer
  // to make, and a minute of silence is a player tabbed out, taken off before the handover)
  const playing = setInterval(() => ann.send(pose()), 5000);
  await up(young);
  // (waited for well past the forty seconds below: by the clock of a machine whose timers are fine it ran out as the old server went)
  const waiting = bob.join(B, 120_000);
  // (forty seconds of it: longer than the server used to wait for anything)
  for (let k = 0; k < 40; k++) {
    await sleep(1000);
    if (k === 20) ann.send(me(37, 2));
    assert.ok(!bob.got.some((m) => m.t === 'welcome'), `somebody was let into the new server ${k + 1} s after it started, while the old one was still being reached:\n${young.log.slice(-500)}`);
    assert.ok(!/\[keep\]/.test(young.log), `the new server made up its mind about what is kept while the old one was still being reached:\n${young.log.slice(-500)}`);
  }
  assert.ok(!bob.shut, 'whoever was waiting for the new server was turned away');
  checks++;
  console.log('  ok  for as long as the old server is the one being reached, the new one lets nobody in and decides nothing');

  // ---- she plays to the last moment; the address is handed over. Nobody tells the old server to stop (the host
  // does that a minute later): it sees that another server answers where it was reached, and goes by itself
  ann.send(me(33, 3));
  await sleep(400);
  const before = ann.got.filter((m) => m.t === 'restart').length;
  // (and from here the store is as it was that night: once the last word is written it cannot be read for nine
  // seconds, three times as long as the new server waits for anything else)
  lag = 9000;
  reached = B;
  for (let k = 0; k < 200 && old.server.exitCode === null; k++) await sleep(100);
  clearInterval(playing);
  assert.notEqual(old.server.exitCode, null, `the old server did not go when it had been replaced:\n${old.log.slice(-500)}`);
  assert.ok(ann.got.filter((m) => m.t === 'restart').length > before && ann.last('restart')!.in === 0, `whoever was on was not told the server was stopping:\n${old.log.slice(-900)}`);
  assert.ok(/another server has taken over: \d+ characters .*\(the last word\)/.test(old.log), `the old server did not say its last word:\n${old.log.slice(-500)}`);
  assert.ok(kept()?.final, 'the site does not hold a last word');
  const lastWord = kept()!.at;
  checks++;
  console.log('  ok  replaced, the old server sees it for itself: it says so to whoever is on, writes its last word and goes');

  // ---- the new server reads that, and everybody is as they were at the last moment
  assert.ok(await waiting, `whoever was waiting was never let in:\n${young.log.slice(-700)}`);
  assert.ok(/\[keep\] 1 characters and 0 stashes as they were kept/.test(young.log), `the new server did not read the last word:\n${young.log.slice(-700)}`);
  assert.ok(/a newer copy has been written and the site cannot hand it over yet: waiting for it/.test(young.log), `the new server was not told the store had a newer copy it could not yet read:\n${young.log.slice(-700)}`);
  assert.ok(new RegExp(`as they were kept at ${lastWord.replace(/[.]/g, '\\.')}`).test(young.log) && !/not a last word/.test(young.log), `the new server went on with something other than the last word:\n${young.log.slice(-700)}`);
  lag = 0;
  assert.ok(await ann.join(B), 'she was not let into the new server');
  const w = ann.last('welcome')!;
  assert.equal(w.me?.vitals.health, 33, `she is not as she was at the last moment (health ${w.me?.vitals.health}: 64 is the first writing, 41 and 37 are from before it stopped)`);
  assert.equal(JSON.stringify(w.me?.inv).split('handover-test-tin-').length - 1, 3, 'she has not what she carried at the last moment');
  assert.ok(Math.hypot(w.spawn.x - at[0], w.spawn.z - at[1]) < 0.5, 'she is not where she stood');
  const h = (await (await fetch(`http://127.0.0.1:${PUB}/healthz`)).json()) as { boot?: string; why?: string; kept?: string };
  assert.ok(typeof h.boot === 'string' && h.boot.length >= 8, 'the server does not say who it is');
  assert.ok(/^1 characters and 0 stashes as they were kept/.test(h.kept ?? ''), `the server does not say what became of what was kept: ${h.kept}`);
  checks++;
  console.log('  ok  the new server has everybody as they were when the old one stopped, not as they were when it last happened to write');

  // ---- and what was said under the changelog is there, with its heart
  const news = (await (await fetch(`http://127.0.0.1:${B}/news?by=${mark}`)).json()) as { entries: Record<string, { hearts: number; mine: boolean; comments: { text: string }[] } | undefined> };
  assert.deepEqual([news.entries[entry]?.hearts, news.entries[entry]?.mine, news.entries[entry]?.comments.map((c) => c.text)], [1, true, ['kept through the restart']], `the new server has not the changelog's hearts and comments: ${JSON.stringify(news.entries[entry])}`);
  checks++;
  console.log('  ok  the hearts and the comments under the changelog came through with the rest');

  // ---- a deploy is announced to the server before it is made. She has played on since the server last wrote.
  ann.send(pose());
  ann.send(me(29, 4));
  await sleep(400);
  for (let k = 0; k < 100 && !/somebody is on: [0-9]+ characters/.test(young.log); k++) await sleep(100);
  const written = () => files.get('zona/world.json')!.mark;
  const tell = async (sha: string) => {
    const r = await fetch(`http://127.0.0.1:${B}/deploying?sha=${sha}`);
    return { status: r.status, ...((await r.json()) as { ok: boolean; again?: boolean; saved?: string; why?: string }) };
  };
  // (somebody who cannot push says so: the branch does not stand where they say, and nothing is written)
  const marks = written(), stranger = 'e'.repeat(40), pushed = 'd'.repeat(40);
  deployingAt = pushed;
  const no = await tell(stranger);
  assert.deepEqual([no.status, no.ok, written()], [403, false, marks], `a stranger made the server write: ${JSON.stringify(no)}`);
  assert.equal((await tell('nonsense')).status, 400);
  // (asked again at once, by anybody: not looked into for twenty seconds)
  assert.equal((await tell(pushed)).status, 429, 'the branch was looked at twice in a moment');
  await sleep(20_500);
  const yes = await tell(pushed);
  assert.deepEqual([yes.status, yes.ok], [200, true], `the server did not write when a deploy was announced: ${JSON.stringify(yes)}\n${young.log.slice(-500)}`);
  assert.ok(/^[0-9]+ characters and 0 stashes written at .*a deploy is coming/.test(yes.saved ?? ''), `it does not say what it wrote: ${yes.saved}`);
  assert.equal(written(), marks + 1, 'nothing new is on the site');
  assert.equal(kept()?.final, false, 'what was written before a deploy was called a last word');
  const h2 = (await (await fetch(`http://127.0.0.1:${B}/healthz`)).json()) as { saved?: string };
  assert.equal(h2.saved, yes.saved, 'the server does not say on /healthz what it last wrote');
  // (and the same commit announced again writes nothing more)
  const twice = await tell(pushed);
  assert.deepEqual([twice.ok, twice.again, written()], [true, true, marks + 1], 'one commit was written for twice');
  checks++;
  console.log('  ok  told a deploy is coming by whoever can push, a server writes everything first; told by anybody else, it writes nothing');

  // ---- she plays a little longer, and the server is stopped dead: no last word. The next one has her as she was
  // when the deploy was announced, not as she was when the server before it happened to write (33, three tins)
  ann.send(me(21, 5));
  await sleep(300);
  young.server.kill();
  for (let k = 0; k < 100 && young.server.exitCode === null && young.server.signalCode === null; k++) await sleep(100);
  assert.equal(written(), marks + 1, 'a server stopped dead wrote something');
  newest = 'ccccccc3';
  reached = C;
  third = start(C, 'ccccccc3');
  await up(third);
  assert.ok(await ann.join(C, 60_000), `she was not let into the third server:\n${third.log.slice(-700)}`);
  const w3 = ann.last('welcome')!;
  assert.equal(w3.me?.vitals.health, 29, `she is not as she was when the deploy was announced (health ${w3.me?.vitals.health}: 33 is the server before's own writing, 21 is from after the announcement)`);
  assert.equal(JSON.stringify(w3.me?.inv).split('handover-test-tin-').length - 1, 4, 'she has not what she carried when the deploy was announced');
  const h3 = (await (await fetch(`http://127.0.0.1:${C}/healthz`)).json()) as { kept?: string };
  assert.ok(/not a last word/.test(h3.kept ?? ''), `the third server does not say that there was no last word: ${h3.kept}`);
  checks++;
  console.log('  ok  a server that stops dead, with no last word: the next has everybody as they were when the deploy was announced');
} catch (e) {
  failed = e;
} finally {
  old.server.kill();
  young?.server.kill();
  third?.server.kill();
  for (const s of [site, pub, git]) s.close();
  await sleep(600);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* a server still letting go of it */
    }
  }
}
if (failed) {
  console.error('--- the old server\n' + old.log.slice(-1200) + '\n--- the new one\n' + (young?.log.slice(-1500) ?? '') + '\n--- the third\n' + (third?.log.slice(-1500) ?? ''));
  throw failed;
}
console.log(`\n${checks} checks passed`);
process.exit(0);
