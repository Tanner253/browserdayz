// The bot check's course and its judge (src/sim/course.ts), with nothing of the game or the server in it. What has
// to hold:
//   - the course is the plan the owner said yes to: three figures at least hidden from the middle, each figure in
//     sight from somewhere a person can walk to;
//   - the game is shown a figure only when it is in sight, or all but;
//   - somebody who walks the yard, turns to what they are shown and fires, passes, on every course of two hundred;
//   - and what a program does does not: shots at where a figure is before it is shown, shots the moment it is
//     shown, tellings inside a wall, through one, out of the yard or hanging in the air.
//   npx tsx test/course.test.ts
import assert from 'node:assert/strict';
import { BLOCKS, CIV, CourseJudge, LANES, dealCourse, fromPlan, inSight, lookOf, moverAt, walkAt, YARD, type Course } from '../src/sim/course';
import { aimAt, playCourse } from './course-player';

let checks = 0;
const ok = (what: string) => {
  checks++;
  console.log(`  ok  ${what}`);
};

/** the same dice for the same number (the server's own are not this: see server/index.ts) */
function dice(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the plan: hidden from the middle, and each to be had from somewhere
{
  const hidden = new Set<number>();
  const from: number[] = LANES.map(() => 0);
  for (let seed = 1; seed <= 40; seed++) {
    const c = dealCourse(dice(seed));
    for (let i = 0; i < LANES.length; i++) {
      for (let ms = 0; ms < 20_000; ms += 500) {
        if (!inSight(c, i, 0, YARD.eye, 0, ms) && i !== 4 && i !== 1 && i !== 5) hidden.add(i);
        for (let x = -20; x <= 20; x += 2) for (let z = -20; z <= 20; z += 2) if (Math.hypot(x, z) < YARD.r - 1 && !BLOCKS.some((b) => x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3) && inSight(c, i, x, YARD.eye, z, ms)) from[i]++;
      }
    }
    // (from the middle: figures 1 (behind the wall), 3 (in the hut) and 4 (behind the low wall) never)
    for (const i of [0, 2, 3]) for (let ms = 0; ms < 20_000; ms += 250) assert.ok(!inSight(c, i, 0, YARD.eye, 0, ms), `course ${seed}: figure ${i + 1} is in sight from the middle at ${ms} ms`);
  }
  from.forEach((n, i) => assert.ok(n > 200, `figure ${i + 1} is all but never in sight from anywhere (${n})`));
  ok(`the plan: figures 1, 3 and 4 never in sight from the middle; each in sight from many places (${from.join(', ')})`);
}

/** the honest player, saying what it says straight to a judge; the server's count is the game's, a little later */
const play = (c: Course, judge: CourseJudge, how: { wait?: number } = {}) =>
  playCourse(c.turn, c.secs, {
    seen: (ms, x, y, z, yaw, pitch) => judge.seen(ms, x, y, z, yaw, pitch, ms + 60),
    shot: (ms, o, d) => void judge.shot(ms, o, d, ms + 65),
    shown: (ms) => judge.reveal(ms),
    down: () => judge.down,
    done: () => judge.passed || judge.failed(ms0),
    until: (ms) => void (ms0 = ms),
  }, how);
let ms0 = 0;

// ---- somebody honest passes, on every course of two hundred, with the signature enforced
{
  let slowest = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = dealCourse(dice(seed * 7919 + 3)), judge = new CourseJudge(c, 'enforce');
    ms0 = 0;
    const took = await play(c, judge);
    assert.ok(judge.passed, `course ${seed}: somebody who walked, looked and shot did not pass (${judge.report})`);
    slowest = Math.max(slowest, took);
  }
  assert.ok(slowest < 55_000, `the slowest took ${(slowest / 1000).toFixed(0)} s of the sixty`);
  // (and on a phone's connection: everything the game says comes in early by the server's count, and up to half a
  // second late on top of that, unevenly; what it is shown is a fifth of a second old)
  for (let seed = 1; seed <= 40; seed++) {
    const c = dealCourse(dice(seed * 104729 + 5)), judge = new CourseJudge(c, 'enforce');
    let k = 0, at = 0;
    const lag = () => -600 + ((k++ * 7919) % 500);
    await playCourse(c.turn, c.secs, {
      seen: (ms, x, y, z, yaw, pitch) => judge.seen(ms, x, y, z, yaw, pitch, ms + lag()),
      shot: (ms, o, d) => void judge.shot(ms, o, d, ms + lag()),
      shown: (ms) => judge.reveal(Math.max(0, ms - 200)),
      down: () => judge.down,
      done: () => judge.passed || judge.failed(at),
      until: (ms) => void (at = ms),
    });
    assert.ok(judge.passed && judge.wrong === 0, `course ${seed}, on a phone's connection: not passed (${judge.report})`);
  }
  ok(`two hundred courses walked, turned and shot: all passed (the slowest in ${(slowest / 1000).toFixed(0)} s); forty on a phone's slow, uneven line: all passed`);
}

// ---- the game is shown only what is in sight, or all but
{
  let shown = 0, unseen = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const c = dealCourse(dice(seed + 101)), judge = new CourseJudge(c);
    const r = dice(seed);
    for (let k = 0; k < 40; k++) {
      const px = (r() - 0.5) * 36, pz = (r() - 0.5) * 36;
      if (Math.hypot(px, pz) > YARD.r - 1 || BLOCKS.some((b) => px > b.x0 - 0.4 && px < b.x1 + 0.4 && pz > b.z0 - 0.4 && pz < b.z1 + 0.4)) continue;
      const [x, z] = fromPlan(c.turn, px, pz), ms = 1000 + k * 1000;
      const j = new CourseJudge(c);
      j.seen(ms, x, 0, z, 0, 0, ms);
      for (const s of j.reveal(ms)) {
        shown++;
        // (in sight from where they stand, or from half a step aside: never from round a wall)
        const near = [0, 0.6, -0.6].some((dx) => [0, 0.6, -0.6].some((dz) => inSight(c, s[0], px + dx, YARD.eye, pz + dz, ms) || inSight(c, s[0], px + dx, YARD.eye, pz + dz, ms + 150)));
        if (!near) unseen++;
      }
    }
    void judge;
  }
  assert.equal(unseen, 0, `${unseen} of ${shown} figures were shown to somebody who could not have seen them`);
  ok(`the game is shown a figure only in sight or half a step from it (${shown} shown, from 1,200 places)`);
}

// ---- and what a program does
{
  const c = dealCourse(dice(4242));
  const stand = (j: CourseJudge, x: number, z: number, upTo: number, yaw = c.turn) => {
    for (let ms = 0; ms <= upTo; ms += 50) j.seen(ms, x, 0, z, yaw + Math.sin(ms / 300) * 0.05, 0, ms);
  };
  // shots at where a figure is, though it has never been shown: worked out, as the strip let a program work it out
  {
    const j = new CourseJudge(c);
    stand(j, 0, 0, 3000);
    let counted = 0;
    for (let i = 0; i < LANES.length; i++) {
      const p = walkAt(c, i, 3000), [x, z] = fromPlan(c.turn, p.x, p.z), a = aimAt(0, YARD.eye, 0, x, p.y + 1.35, z);
      if (j.shot(3000 + i * 300, [0, YARD.eye, 0], lookOf(a.yaw, a.pitch), 3000 + i * 300) >= 0) counted++;
    }
    assert.equal(counted, 0, 'a figure the game was never shown was counted down');
  }
  // the moment it is shown: no one has seen it yet
  {
    const j = new CourseJudge(c);
    let ms = 0, i = -1;
    for (; ms < 20_000 && i < 0; ms += 50) {
      j.seen(ms, 0, 0, 0, c.turn + Math.sin(ms / 300) * 0.05, 0, ms);
      const s = j.reveal(ms).find((q) => q[6] === 1);
      if (s) i = s[0];
    }
    const p = walkAt(c, i, ms), [x, z] = fromPlan(c.turn, p.x, p.z), a = aimAt(0, YARD.eye, 0, x, p.y + 1.35, z);
    for (let k = 1; k <= 3; k++) j.seen(ms + k * 20, 0, 0, 0, a.yaw, a.pitch, ms + k * 20);
    assert.equal(j.shot(ms + 70, [0, YARD.eye, 0], lookOf(a.yaw, a.pitch), ms + 70), -1, 'a figure was counted down the moment it was shown');
    assert.match(j.why, /in sight long enough/);
  }
  // inside a wall, through one, out of the yard, hanging in the air: three of them, and the go is over
  for (const [what, tell] of [
    ['inside a wall', (j: CourseJudge) => { const [x, z] = fromPlan(c.turn, 0, -7); j.seen(1000, x, 0, z, 0, 0, 1000); }],
    ['through a wall', (j: CourseJudge) => { const [ax, az] = fromPlan(c.turn, 0, -6), [bx, bz] = fromPlan(c.turn, 0, -8); j.seen(2000, ax, 0, az, 0, 0, 2000); j.seen(2400, bx, 0, bz, 0, 0, 2400); }],
    ['out of the yard', (j: CourseJudge) => { const [x, z] = fromPlan(c.turn, 0, 23); j.seen(1000, x, 0, z, 0, 0, 1000); }],
    ['hanging in the air', (j: CourseJudge) => { for (let ms = 1000; ms <= 3000; ms += 50) j.seen(ms, 0, 1.5, 0, 0, 0, ms); }],
  ] as const) {
    const j = new CourseJudge(c);
    j.seen(900, 0, 0, 0, 0, 0, 900);
    tell(j);
    assert.ok(j.wrong >= 1 && j.why.includes(what.split(' ')[0]), `${what}: not seen for what it is (${j.report})`);
  }
  // and a jump is not hanging in the air, nor walking up the ramp onto the catwalk
  {
    const j = new CourseJudge(c);
    for (let ms = 0; ms <= 2000; ms += 50) {
      const t = ms / 1000, h = t > 0.5 && t < 1.2 ? 4.2 * (t - 0.5) - 6 * (t - 0.5) ** 2 : 0;
      j.seen(ms, 0, Math.max(0, h), 0, 0, 0, ms);
    }
    assert.equal(j.wrong, 0, `a jump was taken for something that could not be so (${j.report})`);
  }
  ok('not counted: a figure never shown, a figure the moment it is shown; not so: inside a wall, through one, out of the yard, hanging in the air (a jump is fine)');
}

// ---- courses dealt with variety (2026-10-18): mirrored or not, the cover moved, the one with their hands up about, the
// wall that slides in front of figure 6. Somebody honest passes every one, by the host's tighter limits too; somebody who
// shoots the one with their hands up does not.
{
  const layout = (c: Course) => ({ flip: c.flip, blocks: c.blocks, civ: CIV, mover: (ms: number) => moverAt(c, ms) });
  const tight = { hits: 9, aim: 0.7, wrong: 0 };
  let flipped = 0, slowest = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = dealCourse(dice(seed * 6151 + 11), true), judge = new CourseJudge(c, 'enforce', tight);
    if (c.flip) flipped++;
    ms0 = 0;
    const took = await playCourse(c.turn, c.secs, {
      seen: (ms, x, y, z, yaw, pitch) => judge.seen(ms, x, y, z, yaw, pitch, ms + 60),
      shot: (ms, o, d) => void judge.shot(ms, o, d, ms + 65),
      shown: (ms) => judge.reveal(ms),
      down: () => judge.down,
      done: () => judge.passed || judge.failed(ms0),
      until: (ms) => void (ms0 = ms),
    }, { layout: layout(c) });
    assert.ok(judge.passed, `varied course ${seed} (${c.flip ? 'mirrored' : 'as drawn'}, moved ${c.shift.join(', ')}): somebody honest did not pass (${judge.report})`);
    slowest = Math.max(slowest, took);
  }
  assert.ok(flipped > 60 && flipped < 140, `${flipped} of 200 courses mirrored`);
  // (the one with their hands up is shown, as the figures are, when in sight)
  let civSeen = 0, civShot = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const c = dealCourse(dice(seed * 3571 + 7), true), judge = new CourseJudge(c, 'enforce', tight);
    let at = 0;
    await playCourse(c.turn, c.secs, {
      seen: (ms, x, y, z, yaw, pitch) => judge.seen(ms, x, y, z, yaw, pitch, ms + 60),
      shot: (ms, o, d) => void judge.shot(ms, o, d, ms + 65),
      shown: (ms) => {
        const s = judge.reveal(ms);
        if (s.some((q) => q[0] === CIV)) civSeen++;
        return s;
      },
      down: () => judge.down,
      done: () => judge.passed || judge.failed(at),
      until: (ms) => void (at = ms),
    }, { layout: layout(c), shootCiv: true });
    if (judge.civShot) {
      civShot++;
      assert.ok(!judge.passed && judge.failed(at), `course ${seed}: shooting the one with their hands up did not end the go (${judge.report})`);
    }
  }
  assert.ok(civSeen > 0 && civShot >= 20, `the one with their hands up was seen ${civSeen} times and shot on ${civShot} of 40 courses`);
  ok(`two hundred varied courses (${flipped} mirrored, the cover moved, the wall sliding): all passed by somebody honest, by the tighter limits (the slowest in ${(slowest / 1000).toFixed(0)} s); shooting the one with their hands up ended the go on ${civShot} of 40`);
}

// ---- too sure for a hand, by the limits: 9 landed of 10 fired does not pass, 6 of 20 does
{
  const c = dealCourse(dice(99));
  const j = new CourseJudge(c, 'off', { hits: 9, aim: 0.7, wrong: 0 }) as unknown as { landed: number; shots: number; tooSure: string };
  j.landed = 9;
  j.shots = 10;
  assert.match(j.tooSure, /too sure/);
  j.landed = 6;
  j.shots = 20;
  assert.equal(j.tooSure, '');
  ok('too sure for a hand: 9 of 10 landed is, 6 of 20 is not');
}

console.log(`\n${checks} checks passed`);
