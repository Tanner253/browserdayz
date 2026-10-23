// npx tsx scripts/rejoin-check.ts [out dir]: A DROPPED LINE IS A BLIP, NOT A RELOAD AND A FRESH SPAWN (2026-10-23).
// A player, 2026-10-20: "the server just reloads my game out of nowhere and when i get in i spawn fresh", and "ping
// sometimes spike send me to the parallel universe and you won't be able to see anyone but people can see me". The game
// loaded the whole page again after a dropped line (two to five minutes on the live log), and the body it left in the
// world was killed meanwhile; and a line stuck one way was never given up.
// It starts this tree's server on a port of its own (8194, `.env.local-server`, a data folder of its own, bodies kept
// as on live: as online-check.ts does, and for the same reasons), then has play.mjs open a dev page of this tree
// pointed at it (scripts/rejoin.js): the line is shut under the game, then held silent one way; each time the game
// must be back on the same page, with the same things, where it stood, and the server must say it resumed.
// DEV_PAGE (default http://localhost:5173) must serve this tree; ASSETS_SRC as in online-check.ts. PLAY_PORT 9364.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8194, SITE = 'http://127.0.0.1:9', out = process.argv[2] ?? path.join(os.tmpdir(), 'zp', 'rejoin');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting a server');
const DEV = process.env.DEV_PAGE ?? 'http://localhost:5173', TOOLS = process.env.ASSETS_SRC ?? 'assets-src';
const page = await fetch(`${DEV}/`).then((r) => r.status).catch(() => 0);
assert.equal(page, 200, `the dev page is not running at ${DEV} (launch entry zona-dev)`);

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-rejoin-'));
const server = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  // (a body is left for a dropped line, as on live, and a life a few seconds old already leaves one: FRESH_S)
  env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '300', FRESH_S: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const end = (c: ChildProcess | null) => { if (c?.pid && c.exitCode === null) spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); };
let play: ChildProcess | null = null;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { end(play); end(server); process.exit(130); });
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));

type Run = { how: string; lost: number; back: number; online: boolean; newId: boolean; sameKit: boolean; moved: number; samePage: boolean };
let failed: unknown = null, said = '';
try {
  for (let k = 0; k < 1200 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
  play = spawn(process.execPath, [`${TOOLS}/_wf/me/play.mjs`, 'scripts/rejoin.js', out, '640', '360', `${DEV}/zona?server=http://127.0.0.1:${PORT}`], {
    env: { ...process.env, PLAY_PORT: process.env.PLAY_PORT ?? '9364', PLAY_PRE: `${TOOLS}/_wf/me/still.js`, PLAY_LIGHT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  play.stdout!.on('data', (d) => (said += d));
  play.stderr!.on('data', (d) => (said += d));
  const code = await new Promise<number | null>((r) => { play!.on('exit', r); setTimeout(() => { said += '\n(play.mjs stopped after 10 minutes)'; end(play); r(-1); }, 600_000); });
  console.log(said.trim());
  assert.equal(code, 0, 'play.mjs failed (a page loaded again ends its script: see scripts/rejoin.js)');
  const line = said.split('\n').find((l) => l.includes('REJOIN '));
  assert.ok(line, 'the page script said nothing');
  const res = JSON.parse(line.slice(line.indexOf('REJOIN ') + 7)) as { online?: boolean; kit: string; runs: Run[] };
  assert.notEqual(res.online, false, 'the game did not come up online');
  assert.ok(res.kit, 'the game came in carrying nothing');
  assert.equal(res.runs.length, 2);
  for (const r of res.runs) {
    assert.ok(r.samePage, `${r.how}: the page was loaded again`);
    assert.ok(r.online && r.newId, `${r.how}: not back on a new connection (${JSON.stringify(r)})`);
    assert.ok(r.sameKit, `${r.how}: back with other things than were carried (${JSON.stringify(r)})`);
    assert.ok(r.moved < 3, `${r.how}: back ${r.moved} m from where the line dropped`);
    assert.ok(r.back < 30_000, `${r.how}: ${r.back} ms to come back`);
    console.log(`  ok  ${r.how}: offline after ${r.lost} ms, back in ${r.back} ms on the same page, same kit, ${r.moved} m off`);
  }
  // (the server's side: the silent line was given up by the game, with its reason, and both times the body was taken back)
  assert.match(logged, /went without logging out \(4000 silent\)/, 'the server never heard the game give up the silent line');
  const resumed = logged.split('\n').filter((l) => / resumed /.test(l)).length;
  assert.equal(resumed, 2, `the server resumed ${resumed} times, not 2`);
  console.log('  ok  the server resumed the body both times, and heard the silent line given up (4000 silent)');
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
if (failed) { console.error('REJOIN CHECK FAILED:', failed instanceof Error ? failed.message : failed, '\n--- server log tail ---\n' + logged.slice(-1500)); process.exit(1); }
console.log('REJOIN CHECK PASSED');
process.exit(0);
