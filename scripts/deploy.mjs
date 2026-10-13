// The deploy, in the order that loses nothing: the site, then a save, and only then the server.
//
//   node scripts/deploy.mjs            the site, then the save, then the server
//   node scripts/deploy.mjs --site     the site alone (nothing restarts, so there is nothing to save)
//   node scripts/deploy.mjs --server   the server alone (the site is out already)
//   node scripts/deploy.mjs --dry      says what it would do and asks the live server what it holds; publishes nothing
//   --unsaved                          go on though the live server could not be made to save (say so to whoever owns
//                                      the game first: what is lost is everything since its last writing)
//
// Why (2026-10-13): a deploy was pushed on the strength of the old server's last word alone. That night the old
// server stopped without one, and everybody came back as they had been 68 minutes earlier. Now the server that is
// live is told a deploy is coming BEFORE anything is pushed where the host can see it (server/index.ts,
// `deploying`): the commit goes to the branch `deploying` (which the host does not build), the server sees it
// there, writes everything it keeps and answers with what it wrote. Only on that answer is `main` pushed. The last
// word is still said, and is still the best there is; if it does not come, what is lost is the two or three minutes
// the host takes to build, not hours.
//
// The commit published is HEAD, whatever branch that is.

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const has = (f) => process.argv.includes(`--${f}`);
const dry = has('dry'), siteOnly = has('site'), serverOnly = has('server'), unsaved = has('unsaved');
const SITE = 'https://www.zonapvp.fun';
const SERVER = /VITE_SERVER_URL=(\S+)/.exec(JSON.parse(fs.readFileSync('vercel.json', 'utf8')).buildCommand)?.[1];
if (!SERVER) throw new Error('vercel.json does not say where the game server is (VITE_SERVER_URL)');
const PROTOCOL = Number(/export const PROTOCOL = (\d+)/.exec(fs.readFileSync('src/net/protocol.ts', 'utf8'))?.[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (cmd) => (dry ? console.log(`  (dry) ${cmd}`) : execSync(cmd, { stdio: 'inherit' }));
const say = (s) => console.log(s);
const health = async () => {
  try {
    const r = await fetch(`${SERVER}/healthz`, { signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};
const when = (line, word) => {
  const m = new RegExp(`${word} (\\d{4}-\\d\\d-\\d\\dT[0-9:.]+Z)`).exec(line ?? '');
  return m ? Date.parse(m[1]) : NaN;
};

const head = out('git rev-parse HEAD'), branch = out('git rev-parse --abbrev-ref HEAD');
if (out('git status --porcelain --untracked-files=no')) throw new Error('there are changes not committed: what would go out is not what is in the repository');
say(`publishing ${head.slice(0, 7)} (${branch}), protocol ${PROTOCOL}${dry ? '  [dry: nothing is published]' : ''}`);

// ---- the site
if (!serverOnly) {
  say('\n== the site');
  run('npx vercel --prod --yes');
  if (!dry) {
    const v = await fetch(`${SITE}/version.json`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (v?.protocol !== PROTOCOL) throw new Error(`the site says protocol ${v?.protocol}, and this is ${PROTOCOL}: it did not go out`);
    say(`the site is out: protocol ${v.protocol}`);
  }
}
if (siteOnly) process.exit(0);

// ---- the server: what it holds now, the save, and only then the push
say('\n== the server');
const before = await health();
if (!before) throw new Error(`${SERVER} does not answer: nothing is pushed at a server that cannot be asked what it holds`);
say(`live: boot ${before.boot}, protocol ${before.protocol}, ${before.players} on\n  at its start: ${before.kept}\n  last written: ${before.saved ?? '(a server from before 2026-10-13: it does not say)'}`);
let remote = '';
try {
  remote = out('git ls-remote origin refs/heads/main').split(/\s/)[0];
} catch {
  /* asked again by the push itself */
}
if (remote === head) {
  say('main is at this commit already: there is nothing to push');
  process.exit(0);
}

say('\n-- the save, before the host is told anything');
run('git push -f origin HEAD:refs/heads/deploying');
let saved = null;
for (let k = 0; k < 8 && !saved && !dry; k++) {
  let r = null, body = null;
  try {
    r = await fetch(`${SERVER}/deploying?sha=${head}`, { signal: AbortSignal.timeout(40_000) });
    body = await r.json();
  } catch {
    /* not an answer */
  }
  if (r?.status === 200 && body?.ok) saved = body;
  else if (r?.status === 404 || (r && !body)) break; // a server that knows nothing of this
  else {
    say(`  not yet (${r?.status ?? 'no answer'}: ${body?.why ?? body?.saved ?? ''})`);
    await sleep(r?.status === 429 ? 21_000 : 6000);
  }
}
if (dry) {
  // (a commit that is on no branch yet: a server that knows of this refuses it, and one that does not has no such page)
  const r = await fetch(`${SERVER}/deploying?sha=${head}`).catch(() => null);
  const knows = await r?.json().then((j) => typeof j?.ok === 'boolean').catch(() => false);
  say(`  (dry) the live server ${knows ? 'can be told a deploy is coming, and would save' : 'is from before this and CANNOT be made to save: a push at it rests on its last word alone'}`);
  process.exit(0);
}
let savedAt = NaN;
if (saved) {
  savedAt = when(saved.saved, 'written at');
  say(`  SAVED: ${saved.saved}`);
  const after = await health();
  if (after?.boot !== before.boot) throw new Error('the server changed under this: somebody else is deploying');
  // (a save that is not of this minute is not the save that was asked for, unless there was nothing new to write)
  if (Number.isFinite(savedAt) && Date.now() - savedAt > 120_000 && !saved.again) throw new Error(`what it says it wrote is ${Math.round((Date.now() - savedAt) / 1000)} s old: not pushing on that`);
} else if (!unsaved) {
  throw new Error(`the live server could NOT be made to save (last written: ${before.saved ?? 'it does not say'}).\nNothing is pushed. If it is a server from before 2026-10-13 it has no way to be told: push with --unsaved at a quiet moment, and say first what may be lost.`);
} else say(`  NOT SAVED, and going on because --unsaved was given: if the old server leaves no last word, everything since its last writing is lost`);

say('\n-- the push');
run('git push origin HEAD:refs/heads/main');
if (branch !== 'main') run('git branch -f main HEAD');

say('\n-- waiting for the new server');
let now = null;
for (let k = 0; k < 150; k++) {
  await sleep(5000);
  now = await health();
  if (now && now.boot !== before.boot) break;
}
if (!now || now.boot === before.boot) throw new Error('ten minutes on, the old server still answers: look at the host');
for (let k = 0; k < 110 && now?.kept === 'not read yet'; k++) {
  await sleep(5000);
  now = (await health()) ?? now;
}
say(`new: boot ${now.boot}, protocol ${now.protocol}\n  KEPT: ${now.kept}`);
const keptAt = when(now.kept, 'kept at');
if (!/not a last word/.test(now.kept)) say('\nEverything came through to the moment the old server stopped.');
else if (Number.isFinite(savedAt) && keptAt >= savedAt - 1000) say(`\nThe old server left NO last word. What came through is the save made before the push (${new Date(keptAt).toISOString()}): what anybody did in the ${Math.round((Date.now() - keptAt) / 1000)} s after it, until the old server stopped, is lost. Say so.`);
else {
  say(`\nLOST: the old server left no last word, and what the new one has is from ${Number.isFinite(keptAt) ? new Date(keptAt).toISOString() : 'an unknown time'}. Everything since then is gone. Say so at once.`);
  process.exit(1);
}
