// That nobody honest is taken for a cheat on steep ground (src/sim/slopes.ts), now that the server's checks are
// enforced: the slides, the carried run and the climb that the game itself makes on the real map are played to the
// real server, enforcing, exactly as a game would say them (test/fixtures/slides.json: the body's own positions,
// fifteen a second, recorded from src/game/player.ts in a headless game). Not one of them may be written down,
// refused or held back. And the same face come down faster than legs go IS refused: the check is as it was.
// This starts the real server on a port of its own. About a minute.   npx tsx test/slide-checks.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { SLIDE } from '../src/sim/slopes';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8173;
/** the fastest the server lets anybody go on their own legs, m/s over the ground; what it lets go on top of that every time, metres; and the seconds of it that can be saved up (CHECK.foot, .grace and .carry in server/index.ts) */
const FOOT = 9.5, GRACE = 3, CARRY = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

interface Track { name: string; hz: number; pts: [number, number, number][] }
const tracks = (JSON.parse(readFileSync(path.join('test', 'fixtures', 'slides.json'), 'utf8')) as { tracks: Track[] }).tracks;

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  constructor(public name: string, public key = `slide-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async join(): Promise<boolean> {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.shut && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    if (!w) return false;
    this.id = w.you;
    return true;
  }
  /** where they say their feet are */
  say(p: [number, number, number]) {
    if (!this.shut) this.ws.send(JSON.stringify({ t: 's', p: [p[0], p[1], p[2], 0, 0, 0], w: null, m: [] }));
  }
  /** where somebody else was last said to be, to this player */
  sees(id: number): [number, number] | null {
    for (let k = this.got.length - 1; k >= 0; k--) {
      const m = this.got[k] as { t: string; s?: number[][] };
      const row = m.t === 'ps' ? m.s?.find((r) => r[0] === id) : undefined;
      if (row) return [row[1], row[3]];
    }
    return null;
  }
  get kicked(): string | undefined {
    return (this.got.find((m) => m.t === 'kick') as { reason: string } | undefined)?.reason;
  }
  /** a track said to the server as a game says it: each position at its own moment, however long the last one took to send */
  async play(pts: [number, number, number][], hz: number, faster = 1) {
    const began = Date.now();
    for (let i = 0; i < pts.length; i++) {
      const due = began + (i * 1000) / hz / faster;
      if (due > Date.now()) await sleep(due - Date.now());
      this.say(pts[i]);
    }
  }
}

// ---- first, what the recording itself says, measured as the server measures: over the ground, between positions
const fastest = (t: Track, over: number) => {
  let most = 0;
  for (let i = over; i < t.pts.length; i++) most = Math.max(most, (Math.hypot(t.pts[i][0] - t.pts[i - over][0], t.pts[i][2] - t.pts[i - over][2]) * t.hz) / over);
  return most;
};
let checks = 0;
const slides = tracks.filter((t) => /slid|worked/.test(t.name));
assert.ok(slides.length >= 4 && tracks.length >= 6, 'the recording is not the one this test was written for');
for (const t of tracks) {
  const one = fastest(t, 1), second = fastest(t, t.hz);
  // (never over what feet are let do, between any two positions a game sends; and with room to spare over any second)
  assert.ok(one < FOOT - 1, `"${t.name}" goes ${one.toFixed(2)} m/s over the ground between two positions: the server allows ${FOOT}`);
  assert.ok(second < FOOT - 1.5, `"${t.name}" covers ${second.toFixed(2)} m in a second`);
  // (and never so far under the ground or over it that the server would ask about that)
  for (const [x, y, z] of t.pts) assert.ok(y > ground(x, z) - 0.6 && y < ground(x, z) + 3, `"${t.name}" is ${(y - ground(x, z)).toFixed(2)} m off the ground at ${x}, ${z}`);
}
for (const t of slides) {
  const second = fastest(t, t.hz);
  // a slide gets over the ground no faster than the rule says it may: its own pace, and what it can be worked sideways
  assert.ok(second <= Math.hypot(SLIDE.level, SLIDE.steer) + 0.3, `"${t.name}" covers ${second.toFixed(2)} m in a second: a slide is held to ${SLIDE.level}`);
}
const drop = (t: Track) => t.pts[0][1] - t.pts[t.pts.length - 1][1];
assert.ok(Math.max(...slides.map(drop)) > 85, 'the longest face on the map is not among the slides recorded');
checks++;
console.log('  ok  the recorded slides: ' + tracks.map((t) => `${fastest(t, 1).toFixed(1)}`).join(', ') + ` m/s at most between two positions (the server allows ${FOOT})`);

// ---- then the server itself, enforcing
const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-slides-'));
const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', LINGER_S: '0', CHECKS: 'enforce' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
const flagsOn = (name: string) => logged.split('\n').filter((l) => l.includes('[check') && l.includes(name));
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);

  // Somebody to see them, and one player to each recording: set down at the top of it, a moment given for that
  // (where a player is set down is not questioned for two and a half seconds), and then every position at its moment.
  const wit = new Player('Witness');
  assert.ok(await wit.join());
  wit.say([0, ground(0, 0), 0]);
  const honest = tracks.map((t, k) => ({ t, p: new Player(`Honest${k + 1}`) }));
  for (const h of honest) assert.ok(await h.p.join(), `${h.p.name} was not let in`);
  for (const h of honest) h.p.say(h.t.pts[0]);
  await sleep(2700);
  const keep = setInterval(() => wit.say([0, ground(0, 0), 0]), 1000);
  await Promise.all(honest.map((h) => h.p.play(h.t.pts, h.t.hz)));
  await sleep(500);
  for (const h of honest) {
    assert.deepEqual(flagsOn(h.p.name), [], `a check fired on "${h.t.name}"`);
    assert.equal(h.p.kicked, undefined, `"${h.t.name}" was put off the server: ${h.p.kicked}`);
    const end = h.t.pts[h.t.pts.length - 1], seen = wit.sees(h.p.id);
    assert.ok(seen && Math.hypot(seen[0] - end[0], seen[1] - end[2]) < 1.5, `"${h.t.name}" ended at ${end[0]}, ${end[2]} and is shown at ${seen}: it was held back`);
  }
  checks++;
  console.log(`  ok  ${honest.length} honest descents and climbs, played to an enforcing server as their games would say them: none written down, none held back`);

  // What the server holds feet to is how far one position is from the last: nine and a half metres for every second
  // between them, what was saved of that while going slower (two seconds' worth at most), and three metres let go
  // every time. So the same descent with a jump in it: the longest slide said honestly to its middle, and then its
  // foot in the next breath. Refused, written down, and kept where it was for everybody else.
  const long = slides.reduce((a, b) => (drop(b) > drop(a) ? b : a)), half = long.pts.length >> 1, foot = long.pts[long.pts.length - 1];
  const gap = Math.hypot(foot[0] - long.pts[half][0], foot[2] - long.pts[half][2]);
  assert.ok(gap > FOOT * CARRY + GRACE + 2, `the longest slide is only ${gap.toFixed(0)} m over the ground from its middle to its foot`);
  const cheat = new Player('Cheat');
  assert.ok(await cheat.join());
  cheat.say(long.pts[0]);
  await sleep(2700);
  await cheat.play(long.pts.slice(0, half + 1), long.hz);
  for (let k = 0; k < 4; k++) {
    cheat.say(foot);
    await sleep(1000 / long.hz);
  }
  await sleep(400);
  assert.ok(flagsOn('Cheat').some((l) => /\[check:enforce\] Cheat moved \d+ m in/.test(l)), `a slide with a jump of ${gap.toFixed(0)} m in it was not written down:\n${logged.slice(-500)}`);
  const held = wit.sees(cheat.id);
  assert.ok(held && Math.hypot(held[0] - long.pts[half][0], held[1] - long.pts[half][2]) < 2, `the cheat is shown at ${held}: it was to be kept at the middle of the face, ${long.pts[half][0]}, ${long.pts[half][2]}`);
  checks++;
  console.log(`  ok  the longest slide with its lower half skipped is refused and kept back: ${flagsOn('Cheat')[0]?.replace(/^.*\[check:enforce\] /, '')}`);

  // And one that is only just over it. Down the same face and on, in a straight line, every position a tenth
  // further from the last than the server lets a fifteenth of a second and its grace cover. It is let go while
  // what was saved lasts, and refused from then on.
  const edge = new Player('Edge'), from = long.pts[0];
  const len = Math.hypot(foot[0] - from[0], foot[2] - from[2]), ux = (foot[0] - from[0]) / len, uz = (foot[2] - from[2]) / len;
  const most = FOOT / 15 + GRACE, stride = most * 1.1;
  assert.ok(await edge.join());
  edge.say(from);
  await sleep(2700);
  const over: [number, number, number][] = [];
  for (let i = 1; i <= 24; i++) {
    const x = from[0] + ux * stride * i, z = from[2] + uz * stride * i;
    over.push([x, ground(x, z), z]);
  }
  await edge.play(over, 15);
  await sleep(500);
  clearInterval(keep);
  assert.ok(flagsOn('Edge').some((l) => /Edge moved \d+ m in/.test(l)), `${stride.toFixed(2)} m between positions a fifteenth of a second apart was not written down:\n${logged.slice(-500)}`);
  const kept = wit.sees(edge.id), last = over[over.length - 1];
  assert.ok(kept && Math.hypot(kept[0] - last[0], kept[1] - last[2]) > stride * 3, `Edge is shown at ${kept}, all but where it said it was`);
  checks++;
  // (the most an honest slide in the recording covers between two positions, beside what the server allows between two)
  const honestMost = Math.max(...slides.map((s) => fastest(s, 1))) / 15;
  console.log(`  ok  positions ${stride.toFixed(2)} m apart, a tenth over the ${most.toFixed(2)} m the server allows between two, are refused (the furthest apart an honest slide puts two is ${honestMost.toFixed(2)} m)`);
  for (const p of [wit, cheat, edge, ...honest.map((h) => h.p)]) p.ws.close();
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(500);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the server still letting go of it */
  }
}
if (failed) {
  console.error(logged.slice(-1200));
  throw failed;
}
console.log(`\n${checks} checks passed`);
process.exit(0);
