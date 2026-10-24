// node scripts/test-all.mjs [jobs]: EVERY TEST, several at a time (2026-10-14). It was a shell script outside the repo,
// four at a time, with three pairs of tests that started their servers on the same ports and so failed together and
// were run again alone: about fifteen minutes. Each test now has ports of its own (checked here before anything runs),
// and the machine has cores to spare: eight at a time by default. Whatever fails is run once more alone (a test that
// leans on timing can lose a race on a busy machine); only that second result counts. Never test/devnet.test.ts: it
// uses the public Solana devnet faucet and sends transactions. Logs: <tmp>/zona-tests/<name>.log.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { takeLock } from './card-lock.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const JOBS = Number(process.argv[2] ?? process.env.TEST_JOBS ?? 8);
const LOGS = path.join(os.tmpdir(), 'zona-tests');
// (one suite at a time across every copy of the repo: two at once took the same ports and both hung, 2026-10-24)
await takeLock(path.join(os.tmpdir(), 'zona-tests.lock'), ROOT, 'the test suite');
fs.rmSync(LOGS, { recursive: true, force: true });
fs.mkdirSync(LOGS, { recursive: true });
const tests = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.ts') && f !== 'devnet.test.ts').sort();

// (no two tests may listen on one port: every `NAME = 8nnn` of a test file, by file)
const ports = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.ts'))) {
  for (const m of fs.readFileSync(path.join(ROOT, 'test', f), 'utf8').matchAll(/\b[A-Z][A-Z_]*\s*=\s*(8\d{3})\b/g)) {
    const p = Number(m[1]), had = ports.get(p);
    if (had && had !== f) { console.error(`PORT ${p} is used by both ${had} and ${f}: give one of them another`); process.exit(2); }
    ports.set(p, f);
  }
}

const tsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = (f, tag = '') => new Promise((done) => {
  const t0 = Date.now(), log = fs.createWriteStream(path.join(LOGS, f.replace('.test.ts', '') + tag + '.log'));
  const p = spawn(process.execPath, [tsx, path.join('test', f)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  const keep = (d) => { log.write(d); tail = (tail + d).slice(-1500); };
  p.stdout.on('data', keep);
  p.stderr.on('data', keep);
  p.on('close', (code) => { log.end(); done({ f, ok: code === 0, s: (Date.now() - t0) / 1000, tail }); });
});

const t0 = Date.now();
const queue = [...tests], results = [];
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (queue.length) {
    const r = await run(queue.shift());
    results.push(r);
    if (!r.ok) console.log(`  failed (to be run again alone): ${r.f}`);
  }
}));
const failing = [];
for (const r of results.filter((x) => !x.ok).sort((a, b) => a.f.localeCompare(b.f))) {
  const again = await run(r.f, '.again');
  if (again.ok) console.log(`  passes alone: ${r.f}`);
  else {
    failing.push(r.f);
    console.log(`FAILS: ${r.f}\n${again.tail.split('\n').filter((l) => l.trim() && !/^\s+at /.test(l)).slice(-6).join('\n')}`);
  }
}
const slow = [...results].sort((a, b) => b.s - a.s).slice(0, 3).map((r) => `${r.f.replace('.test.ts', '')} ${Math.round(r.s)} s`).join(', ');
console.log(`SUITE: ${tests.length} files, ${failing.length} failing, ${Math.round((Date.now() - t0) / 1000)} s with ${JOBS} at a time (slowest: ${slow}); logs in ${LOGS}`);
process.exit(failing.length ? 1 : 0);
