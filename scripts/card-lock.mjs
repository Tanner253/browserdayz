// One headless game on the graphics card at a time (the owner, 2026-10-18: "gpu and cpu load is a main bottleneck
// when running multiple lanes at same time"). Two lanes' Chromes on one card each run slower than one after the
// other, and the frame times they measure are false. play.mjs, film.mjs and stills.mjs wait here for whichever run
// holds the card; PLAY_GL=swiftshader runs (drawn by the processor) and PLAY_LOCK=0 do not wait.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCK = path.join(os.tmpdir(), 'zona-card.lock');
// (the holder writes the lock again every minute; one not written for five is left by a run that was killed)
const BEAT_MS = 60_000, STALE_MS = 5 * 60_000;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** waits until no other headless run holds the card, then holds it until this process ends */
export async function takeCard(label) {
  if (process.env.PLAY_LOCK === '0') return;
  return takeLock(LOCK, label, 'the graphics card', ' (PLAY_LOCK=0 runs alongside)');
}

/** the same wait for any one-at-a-time thing (test-all: two suites at once share ports and hang) */
export async function takeLock(LOCK, label, what, hint = '') {
  let told = 0;
  for (;;) {
    const at = Date.now();
    try {
      fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, label, since: at, at }), { flag: 'wx' });
      setInterval(() => {
        const held = read(LOCK);
        if (held?.pid === process.pid) fs.writeFileSync(LOCK, JSON.stringify({ ...held, at: Date.now() }));
      }, BEAT_MS).unref();
      process.on('exit', () => { if (read(LOCK)?.pid === process.pid) try { fs.rmSync(LOCK); } catch { /* gone */ } });
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const held = read(LOCK);
    let stale = held ? !alive(held.pid) || at - held.at > STALE_MS : false;
    // (a lock that cannot be read and is not new was half written by a run that died)
    if (!held) try { stale = at - fs.statSync(LOCK).mtimeMs > 5000; } catch { continue; }
    if (stale) {
      if (JSON.stringify(read(LOCK)) === JSON.stringify(held)) try { fs.rmSync(LOCK); } catch { /* taken already */ }
      continue;
    }
    if (held && at - told > 30_000) {
      told = at;
      console.log(`waiting for ${what}: ${held.label} (pid ${held.pid}) has had it ${Math.round((at - held.since) / 1000)} s${hint}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
