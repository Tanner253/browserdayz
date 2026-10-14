// The deploy, in the order that loses nothing: the site, then a save, and only then the server.
//
//   node scripts/deploy.mjs            the site, then the save, then the server (or, the server untouched, the push alone)
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
  if (/could NOT/.test(line ?? '')) return NaN;
  const m = new RegExp(`${word} (\\d{4}-\\d\\d-\\d\\dT[0-9:.]+Z)`).exec(line ?? '');
  return m ? Date.parse(m[1]) : NaN;
};
/** can the server that is live be told a deploy is coming (one from before 2026-10-13 has no such page) */
const canSave = async () => {
  // (a commit that is on no branch: a server that knows of this refuses it by name, and one that does not has no such page)
  const r = await fetch(`${SERVER}/deploying?sha=${'0'.repeat(40)}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  return !!(await r?.json().then((j) => typeof j?.ok === 'boolean').catch(() => false));
};

const head = out('git rev-parse HEAD'), branch = out('git rev-parse --abbrev-ref HEAD');
if (out('git status --porcelain --untracked-files=no')) throw new Error('there are changes not committed: what would go out is not what is in the repository');
// (and a file nobody has added, where the site is built from: the site's upload takes whatever is in the folder)
const stray = out('git status --porcelain --untracked-files=all -- public api src server scripts index.html vercel.json package.json');
if (stray) throw new Error(`there are files here that are not in the repository, and the site would be built with them:\n${stray}`);
say(`publishing ${head.slice(0, 7)} (${branch}), protocol ${PROTOCOL}${dry ? '  [dry: nothing is published]' : ''}`);

// ---- whether the live server can be made to save is asked before anything is published: found afterwards, the new
// site was already out, and whoever opened the page sat at "the server is being updated" until somebody came back
let able = true;
if (!siteOnly) {
  able = await canSave();
  if (!able && !unsaved) throw new Error(`the live server cannot be told a deploy is coming (it is from before 2026-10-13), so it cannot be made to save first.\nNothing has been published. Run again with --unsaved at a quiet moment, and say first that what is lost, if it leaves no last word, is everything since its last writing.`);
}

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

// ---- whether this release touches the game server at all. Its host builds it only when a file it is made of has
// changed: the Build Filter set on the host by the owner, 2026-10-14, these paths, which must be kept the same as
// there. A release of the site or the arena alone leaves it running: nothing to save, and nobody put out. `main` is
// pushed all the same, so that it is what is live. (`--server` goes the whole way regardless.)
const ZONA = ['server', 'src/sim', 'src/world', 'src/net', 'src/core', 'package.json', 'package-lock.json', 'render.yaml'];
const ARENA = ['arena', 'src/sim', 'src/world', 'src/net', 'src/core', 'package.json', 'package-lock.json'];
const changed = (paths) => {
  try {
    return !!out(`git diff --name-only ${remote}..${head} -- ${paths.join(' ')}`);
  } catch {
    return true; // (not known: as if it is)
  }
};
if (remote && !serverOnly && !changed(ZONA)) {
  say('\n-- the game server is untouched by this release: its host leaves it running, so there is nothing to save');
  run('git push origin HEAD:refs/heads/main');
  if (branch !== 'main' && !dry) run('git branch -f main HEAD');
  say(changed(ARENA) ? 'the arena is rebuilt by its host (a match being played ends)' : 'the arena is untouched too');
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
  say(`  (dry) the live server ${able ? 'can be told a deploy is coming, and would save' : 'is from before this and CANNOT be made to save: a push at it rests on its last word alone'}`);
  process.exit(0);
}
let savedAt = NaN;
if (saved) {
  savedAt = when(saved.saved, 'written at');
  say(`  SAVED: ${saved.saved}`);
  const after = await health();
  if (after?.boot !== before.boot) throw new Error('the server changed under this: somebody else is deploying');
  // (a save that is not of this minute is not the save that was asked for, unless there was nothing new to write)
  // (said `again`, it is the save of an earlier try at this same commit: good for ten minutes, and no longer)
  const old = Number.isFinite(savedAt) ? Date.now() - savedAt : 0;
  if (old > (saved.again ? 600_000 : 120_000)) throw new Error(`what it says it wrote is ${Math.round(old / 1000)} s old: not pushing on that. Wait a minute and run this again.`);
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
// (the new server waits for the old one's last word, and then for the store to hand it over: thirteen minutes at the most)
for (let k = 0; k < 170 && now?.kept === 'not read yet'; k++) {
  await sleep(5000);
  now = (await health()) ?? now;
}
say(`new: boot ${now.boot}, protocol ${now.protocol}\n  KEPT: ${now.kept}`);
const keptAt = when(now.kept, 'kept at');
const read = /^\d+ characters and \d+ stashes as they were kept at /.test(now.kept ?? '');
if (now.kept === 'not read yet') {
  say('\nNOT KNOWN: a quarter of an hour on, the new server has still not read what was kept. Nobody is let in until it has. Look at /healthz again in a few minutes, and at the host.');
  process.exit(1);
} else if (/nothing has been kept yet/.test(now.kept) && !/\d+ characters/.test(before.kept ?? '')) say('\nThere was nothing kept before, and there is nothing now: as it should be.');
else if (!read) {
  say(`\nNOT READ: the new server did not take in what was kept ("${now.kept}"). Everybody on it begins afresh until this is put right, and it writes nothing over what is kept. Say so at once.`);
  process.exit(1);
} else if (!/not a last word/.test(now.kept)) say('\nEverything came through to the moment the old server stopped.');
// (the save's line gives the time it was DONE and the file the time it was BEGUN: a minute between them is the same save)
else if (Number.isFinite(savedAt) && keptAt >= savedAt - 60_000) say(`\nThe old server left NO last word. What came through is the save made before the push (${new Date(keptAt).toISOString()}): what anybody did in the ${Math.round((Date.now() - keptAt) / 1000)} s since is lost. The new server goes on looking for the last word for a quarter of an hour: read "kept" on /healthz again then.`);
else {
  say(`\nLOST: the old server left no last word, and what the new one has is from ${Number.isFinite(keptAt) ? new Date(keptAt).toISOString() : 'an unknown time'}. Everything since then is gone. Say so at once.`);
  process.exit(1);
}
