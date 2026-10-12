// How another player is shown when what is heard of them does not come evenly (src/net/timeline.ts): a runner is
// sent through a made-up line (their game's fifteen reports a second, held up on the way to the server, passed on
// by the server's own fifteen a second, held up again on the way here, and taken up between the frames of the
// game that draws them), and what is drawn of them each frame is measured against what they did: how often the
// runner on the screen stands nearly still or covers the ground at twice the speed, and how far behind they are.
// Both ways of spacing the reports are run over the very same arrivals: by when each came (as it was), and by
// when each was true.
//   npx tsx test/timeline.test.ts
import assert from 'node:assert/strict';
import { Timeline, between, caughtUp } from '../src/net/timeline';

/** a dice that falls the same way every run */
const dice = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** how long one report is held up, ms: a list of [share of reports, from, to] */
type Jitter = [number, number, number][];
const heldUp = (j: Jitter, r: () => number) => {
  let u = r();
  for (const [share, a, b] of j) {
    if (u < share) return a + (b - a) * r();
    u -= share;
  }
  return 0;
};

interface Line { name: string; up: number; down: number; jitter: Jitter; senderFps: number; senderUneven: number; watcherFps: number; watcherBusy: number }

const SPEED = 6, RADIUS = 18, SEND_HZ = 15, TICK = 1000 / 15, SECONDS = 120;
/** where the runner truly is at a time (ms): round a ring, so the way they go is always turning */
const truly = (t: number): [number, number] => {
  const a = ((SPEED * t) / 1000) / RADIUS;
  return [Math.cos(a) * RADIUS, Math.sin(a) * RADIUS];
};

function run(line: Line, seed: number) {
  const r = dice(seed);
  // --- their game: a frame at a time, a report when a fifteenth of a second is up (as Game.sendState does)
  const THEIR_CLOCK = 7_654_321;
  const sent: { stamp: number; pos: [number, number]; at: number }[] = [];
  let lastArrive = 0;
  for (let t = 0, acc = 0; t < SECONDS * 1000; ) {
    const frame = (1000 / line.senderFps) * (1 + (r() * 2 - 1) * line.senderUneven);
    t += frame;
    acc += frame / 1000;
    if (acc >= 1 / SEND_HZ) {
      acc = acc > 2 / SEND_HZ ? 0 : acc - 1 / SEND_HZ;
      // (one after another down the one line: a later report does not overtake an earlier)
      lastArrive = Math.max(lastArrive, t + line.up + heldUp(line.jitter, r));
      sent.push({ stamp: Math.round(t + THEIR_CLOCK), pos: truly(t), at: lastArrive });
    }
  }
  // --- the server: fifteen times a second by its own clock, the last it has heard
  const came: { stamp: number; pos: [number, number]; at: number }[] = [];
  lastArrive = 0;
  for (let tick = 23, i = -1; tick < SECONDS * 1000; tick += TICK + (r() - 0.5) * 2) {
    while (i + 1 < sent.length && sent[i + 1].at <= tick) i++;
    if (i < 0) continue;
    lastArrive = Math.max(lastArrive, tick + line.down + heldUp(line.jitter, r));
    came.push({ stamp: sent[i].stamp, pos: sent[i].pos, at: lastArrive });
  }
  // --- the game that draws them: a frame at a time; what has come is taken up when the frame's own work is done
  const old: { t: number; p: [number, number] }[] = [];
  const kept: { t: number; p: [number, number] }[] = [];
  const tl = new Timeline();
  let stamped: number | undefined;
  const shown = (snaps: typeof old, t: number): [number, number] | null => {
    if (!snaps.length) return null;
    let a = snaps[0], b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i > 0; i--) if (snaps[i - 1].t <= t) { a = snaps[i - 1]; b = snaps[i]; break; }
    const k = b.t > a.t ? Math.min(1.25, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    return [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k];
  };
  const F = 1000 / line.watcherFps;
  const out = { old: { hitch: 0, bound: 0, worst: 0, behind: 0 }, timed: { hitch: 0, bound: 0, worst: 0, behind: 0 }, frames: 0 };
  /** the new way, as RemotePlayer.update does it: carried on a little past the newest, and ground made up at a run */
  let drawn: [number, number] | null = null;
  const timed = (t: number): [number, number] | null => {
    const span = between(kept, t);
    if (!span) return null;
    const { a, b, k } = span;
    const to: [number, number] = [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k];
    if (!drawn) return (drawn = to);
    const secs = (b.t - a.t) / 1000, going = secs > 0 ? Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) / secs : 0;
    const part = caughtUp(Math.hypot(to[0] - drawn[0], to[1] - drawn[1]), going, F / 1000);
    return (drawn = [drawn[0] + (to[0] - drawn[0]) * part, drawn[1] + (to[1] - drawn[1]) * part]);
  };
  let was: { old: [number, number] | null; timed: [number, number] | null } = { old: null, timed: null };
  let i = 0;
  for (let now = 0; now < SECONDS * 1000; now += F) {
    // (reports that came while the last frame was being worked on are taken up when it was done)
    for (; i < came.length && came[i].at <= now; i++) {
      const c = came[i], took = Math.max(c.at, now - F + F * line.watcherBusy);
      old.push({ t: took, p: c.pos });
      if (old.length > 12) old.shift();
      if (c.stamp === stamped) continue;
      const epoch = tl.epoch, at = tl.place(c.stamp, took);
      if (tl.epoch !== epoch) kept.length = 0;
      stamped = c.stamp;
      kept.push({ t: at, p: c.pos });
      if (kept.length > 12) kept.shift();
    }
    const a = shown(old, now - 110), b = timed(tl.at(now, F / 1000));
    if (now > 5000 && a && b && was.old && was.timed) {
      out.frames++;
      for (const [key, p, q] of [['old', a, was.old], ['timed', b, was.timed]] as const) {
        const step = Math.hypot(p[0] - q[0], p[1] - q[1]), should = (SPEED * F) / 1000;
        // (a frame in which the runner on the screen goes at under half their speed, or over half as fast again)
        if (step < should * 0.5 || step > should * 1.5) out[key].hitch++;
        // (and one in which they cover three frames' ground or more: a bound)
        if (step > should * 3) out[key].bound++;
        out[key].worst = Math.max(out[key].worst, step / should);
        // (how far behind the truth what is shown is, by how far round the ring it is)
        const ang = Math.atan2(p[1], p[0]), trueAng = ((SPEED * now) / 1000) / RADIUS;
        let d = (trueAng - ang) % (Math.PI * 2);
        if (d < 0) d += Math.PI * 2;
        out[key].behind += ((d * RADIUS) / SPEED) * 1000;
      }
    }
    was = { old: a, timed: b };
  }
  return { name: line.name, frames: out.frames, old: { hitch: out.old.hitch / out.frames, bound: out.old.bound / out.frames, worst: out.old.worst, behind: out.old.behind / out.frames }, timed: { hitch: out.timed.hitch / out.frames, bound: out.timed.bound / out.frames, worst: out.timed.worst, behind: out.timed.behind / out.frames } };
}

const CLEAN: Jitter = [[1, 0, 4]];
/** what the live server's answers showed from two hundred miles off (2026-10-12: nine in ten within 16 ms, 99 in 100 within 64) */
const NEAR: Jitter = [[0.86, 0, 10], [0.1, 10, 30], [0.03, 30, 70], [0.01, 70, 150]];
/** across an ocean, over the one connection a browser gives a game */
const FAR: Jitter = [[0.7, 0, 15], [0.2, 15, 50], [0.08, 50, 120], [0.02, 150, 300]];
const lines: Line[] = [
  { name: 'a clean line, everybody at sixty frames', up: 15, down: 15, jitter: CLEAN, senderFps: 60, senderUneven: 0.05, watcherFps: 60, watcherBusy: 0.5 },
  { name: 'the same line, as the live server answered it', up: 20, down: 20, jitter: NEAR, senderFps: 60, senderUneven: 0.1, watcherFps: 60, watcherBusy: 0.5 },
  { name: 'across an ocean', up: 85, down: 85, jitter: FAR, senderFps: 60, senderUneven: 0.1, watcherFps: 60, watcherBusy: 0.5 },
  { name: 'a clean line, watched at 25 frames with the processor full', up: 15, down: 15, jitter: CLEAN, senderFps: 60, senderUneven: 0.05, watcherFps: 25, watcherBusy: 0.97 },
  { name: 'a clean line, the runner\'s own game at 30 uneven frames', up: 15, down: 15, jitter: CLEAN, senderFps: 30, senderUneven: 0.4, watcherFps: 60, watcherBusy: 0.5 },
  { name: 'across an ocean, watched at 30 frames', up: 85, down: 85, jitter: FAR, senderFps: 45, senderUneven: 0.3, watcherFps: 30, watcherBusy: 0.9 },
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
let failed = 0;
for (const line of lines) {
  const res = run(line, 20261012);
  console.log(`\n${res.name}`);
  console.log(`   by when it came:   hitching in ${pct(res.old.hitch).padStart(6)} of frames, a bound in ${pct(res.old.bound).padStart(5)}, at worst ${res.old.worst.toFixed(1)}x their speed in a frame, shown ${res.old.behind.toFixed(0)} ms behind`);
  console.log(`   by when it was so: hitching in ${pct(res.timed.hitch).padStart(6)} of frames, a bound in ${pct(res.timed.bound).padStart(5)}, at worst ${res.timed.worst.toFixed(1)}x their speed in a frame, shown ${res.timed.behind.toFixed(0)} ms behind`);
  try {
    // never worse than it was, and where it was bad, a small part of it
    assert.ok(res.timed.hitch <= Math.max(0.004, res.old.hitch * 0.25), `still hitching in ${pct(res.timed.hitch)} of frames (was ${pct(res.old.hitch)})`);
    // and nobody bounds: what is behind is made up at a run
    assert.ok(res.timed.worst <= 2.6, `somebody still covers ${res.timed.worst.toFixed(1)} frames' ground in one`);
    // and nobody is shown much further in the past for it than their line needs
    assert.ok(res.timed.behind - res.old.behind < 130, `shown ${(res.timed.behind - res.old.behind).toFixed(0)} ms further behind`);
  } catch (e) {
    failed++;
    console.log(`   FAILED: ${(e as Error).message}`);
  }
}

// --- the same report passed on twice says nothing new; a clock that begins again is taken afresh
{
  const tl = new Timeline();
  tl.place(1000, 5000);
  const e = tl.epoch;
  tl.place(1067, 5067);
  assert.equal(tl.epoch, e, 'a report on time is not a new clock');
  tl.place(50, 5134);
  // (their clock went back by a second: far behind for ten together)
  for (let k = 1; k < 10; k++) tl.place(50 + k * 67, 5134 + k * 67);
  assert.equal(tl.epoch, e + 1, 'a clock that went back is taken afresh after ten reports');
  tl.place(900_000, 6000);
  assert.equal(tl.epoch, e + 2, 'a clock that leapt ahead is taken afresh at once');
  assert.ok(Math.abs(tl.theirs(6000) - 900_000) < 1, 'now, by their clock');
}

console.log(failed ? `\n${failed} FAILED` : '\nall as it should be');
process.exit(failed ? 1 : 0);
