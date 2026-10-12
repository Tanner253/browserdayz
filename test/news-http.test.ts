// The changelog's hearts and comments asked of a real game server over the wire, as the page asks: what it answers,
// what it refuses, that another host may ask (the page is on the site, the server elsewhere), and that a request
// too long is not read. The server here keeps nothing (KEEP off) and reaches no site.
//
//   npx tsx test/news-http.test.ts
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 8700 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${port}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-news-'));
const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(port), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', KEEP: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let said = '';
server.stdout?.on('data', (d) => (said += d));
server.stderr?.on('data', (d) => (said += d));
const stop = () => {
  try {
    server.kill();
  } catch {
    /* gone */
  }
};
process.on('exit', stop);

let passed = 0;
const ok = async (name: string, fn: () => Promise<void>) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const post = async (p: string, body: unknown, raw?: string) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://www.zonapvp.fun' }, body: raw ?? JSON.stringify(body) });
  return { status: r.status, cors: r.headers.get('access-control-allow-origin'), json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
};
const A = 'a'.repeat(32), B = 'b'.repeat(32);

try {
  // (the world is made first: a few seconds)
  for (let i = 0; ; i++) {
    const up = await fetch(`${base}/healthz`).then((r) => r.ok, () => false);
    if (up) break;
    if (i > 240 || server.exitCode !== null) throw new Error(`the server did not come up:\n${said.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  // an entry the page really has (the server read the page it was built with)
  const html = fs.readFileSync('public/changelog/index.html', 'utf8');
  const entry = /<article class="entry" id="([a-z0-9-]+)"/.exec(html)![1];

  await ok('asked of from another host, it answers: nothing yet', async () => {
    const r = await fetch(`${base}/news?by=${A}`, { headers: { origin: 'https://www.zonapvp.fun' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await r.json(), { ok: true, entries: {} });
  });

  await ok('a heart, a comment, and what the page is then told', async () => {
    const h = await post('/news/heart', { entry, by: A });
    assert.deepEqual([h.status, h.cors, h.json], [200, '*', { ok: true, hearts: 1, mine: true }]);
    const c = await post('/news/comment', { entry, by: A, name: 'Sable', text: 'more of this please' });
    assert.equal(c.json?.ok, true);
    const seen = (await (await fetch(`${base}/news?by=${B}`)).json()) as { entries: Record<string, { hearts: number; mine: boolean; comments: { name: string; text: string; mine?: boolean }[] }> };
    assert.equal(seen.entries[entry].hearts, 1);
    assert.equal(seen.entries[entry].mine, false);
    assert.deepEqual(seen.entries[entry].comments.map((q) => [q.name, q.text, q.mine ?? false]), [['Sable', 'more of this please', false]]);
  });

  await ok('what is refused is refused with a reason, and nothing of it is kept', async () => {
    assert.equal((await post('/news/comment', { entry, by: B, name: 'x', text: 'go to http://bad.example now' })).json?.ok, false);
    assert.equal((await post('/news/comment', { entry: 'no-such-entry', by: B, name: 'x', text: 'hello' })).json?.ok, false);
    assert.equal((await post('/news/heart', { entry, by: 'not a mark' })).json?.ok, false);
    assert.equal((await post('/news/heart', null, 'not json')).status, 400);
    assert.equal((await post('/news/nothing', { entry })).status, 404);
    assert.equal((await fetch(`${base}/news/heart`)).status, 405);
    const long = await fetch(`${base}/news/comment`, { method: 'POST', body: 'x'.repeat(20_000) }).then((r) => r.status, () => 413);
    assert.equal(long, 413);
    const seen = (await (await fetch(`${base}/news`)).json()) as { entries: Record<string, { comments: unknown[] }> };
    assert.equal(seen.entries[entry].comments.length, 1);
  });

  await ok('whoever wrote it takes it down; nobody else does', async () => {
    const seen = (await (await fetch(`${base}/news?by=${A}`)).json()) as { entries: Record<string, { comments: { id: number; mine?: boolean }[] }> };
    const id = seen.entries[entry].comments[0].id;
    assert.equal(seen.entries[entry].comments[0].mine, true);
    assert.equal((await post('/news/remove', { id, by: B })).json?.ok, false);
    assert.equal((await post('/news/remove', { id, by: A })).json?.ok, true);
    const after = (await (await fetch(`${base}/news`)).json()) as { entries: Record<string, { comments: unknown[] }> };
    assert.equal(after.entries[entry].comments.length, 0);
  });

  console.log(`${passed} checks passed`);
} finally {
  stop();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* still held */
  }
}
