// node scripts/typecheck.mjs: the three type-checks (game, server, api) at once, each remembering what it checked
// last time, so a run after a small change takes seconds, not the 46 of three cold runs (2026-10-18: the owner's lanes
// were held up by the processor). Each tree keeps its own memory under node_modules/.cache (worktrees share one
// node_modules through a junction, so the file is named by the tree). Prints each check's result and exits 1 if any
// failed. `npm run build` still checks cold, as Vercel does.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const tree = createHash('sha1').update(ROOT.toLowerCase()).digest('hex').slice(0, 8);
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'tsc');
fs.mkdirSync(CACHE, { recursive: true });

const check = (config) => new Promise((done) => {
  const t0 = Date.now();
  let said = '';
  const p = spawn(process.execPath, [TSC, '--noEmit', '-p', config, '--incremental', '--tsBuildInfoFile', path.join(CACHE, `${tree}-${config}.tsbuildinfo`)], { cwd: ROOT });
  p.stdout.on('data', (d) => { said += d; });
  p.stderr.on('data', (d) => { said += d; });
  p.on('exit', (code) => done({ config, code, said, s: ((Date.now() - t0) / 1000).toFixed(1) }));
});

const results = await Promise.all(['tsconfig.json', 'tsconfig.server.json', 'tsconfig.api.json'].map(check));
for (const r of results) {
  if (r.said.trim()) console.log(r.said.trimEnd());
  console.log(`${r.code === 0 ? 'ok  ' : 'FAIL'} ${r.config} (exit ${r.code}, ${r.s} s)`);
}
process.exit(results.every((r) => r.code === 0) ? 0 : 1);
