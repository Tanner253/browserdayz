// npx tsx scripts/split/online-check.ts [out dir]: THE GAME COMES UP ONLINE WITH NO PAGE ERRORS (the split's third proof, 2026-10-14).
// It starts this tree's server on a port of its own (8193, `.env.local-server`, a data folder of its own: as
// join-check.ts does, and for the same reasons), then has play.mjs open the dev page (5173: it must be running)
// pointed at that server, join, and stand in the world a few seconds. Any page error or console error fails it.
// PLAY_GL=swiftshader draws on the processor instead of the card. PLAY_PORT defaults to 9361 here.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8193, SITE = 'http://127.0.0.1:9', out = process.argv[2] ?? path.join(os.tmpdir(), 'zp', 'split', 'online');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting a server');
const page = await fetch('http://localhost:5173/').then((r) => r.status).catch(() => 0);
assert.equal(page, 200, 'the dev page is not running on 5173 (launch entry zona-dev)');

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-online-'));
const server = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
// (a child's own children are not ended with it on Windows: tsx's server, play.mjs's Chrome. So the whole tree, and on any way out)
const end = (c: ChildProcess | null) => { if (c?.pid && c.exitCode === null) spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); };
let play: ChildProcess | null = null;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { end(play); end(server); process.exit(130); });
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));

let failed: unknown = null, said = '';
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
  play = spawn(process.execPath, ['assets-src/_wf/me/play.mjs', 'scripts/split/online.js', out, '1280', '720', `http://localhost:5173/?server=http://127.0.0.1:${PORT}`], {
    env: { ...process.env, PLAY_PORT: process.env.PLAY_PORT ?? '9361', PLAY_PRE: 'assets-src/_wf/me/still.js' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  play.stdout!.on('data', (d) => (said += d));
  play.stderr!.on('data', (d) => (said += d));
  // (ten minutes at most: a page that never gets in is a failure, not a wait)
  const code = await new Promise<number | null>((r) => { play!.on('exit', r); setTimeout(() => { said += '\n(play.mjs stopped after 10 minutes)'; end(play); r(-1); }, 600_000); });
  console.log(said.trim());
  assert.equal(code, 0, 'play.mjs failed');
  assert.match(said, /^ONLINE /m, 'the game did not come up online');
  const errors = said.split('\n').filter((l) => /page error|page error:/.test(l) || /^\s*page error/.test(l));
  assert.equal(errors.length, 0, `the page had errors:\n${errors.join('\n')}`);
  const bad = logged.split('\n').filter((l) => /TypeError|ReferenceError|SyntaxError|RangeError|Unhandled|uncaught|\bat .*\.ts:\d+/i.test(l));
  assert.equal(bad.length, 0, `the server wrote what looks like a crash:\n${bad.slice(0, 10).join('\n')}`);
} catch (e) {
  failed = e;
} finally {
  end(play);
  end(server);
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error('ONLINE CHECK FAILED:', failed instanceof Error ? failed.message : failed, '\n--- server log tail ---\n' + logged.slice(-1200)); process.exit(1); }
console.log(`ONLINE CHECK PASSED (picture: ${path.join(out, 'online.png')})`);
process.exit(0);
