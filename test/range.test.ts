// The bot check's range and its judge (src/sim/range.ts), with nothing of the game or the server in it. What has
// to hold:
//   - a range is the same for the same number, and different for another;
//   - every range dealt is a fair one and a hard one: each figure can be seen from somewhere on the strip, two
//     at least cannot be seen at all from the start, and there is no one place to shoot them all from;
//   - somebody who walks to where each figure can be seen, turns to it, follows it and fires, passes;
//   - and what a program does without walking, looking or waiting does not: shots with nothing said of where it
//     stands, shots through the cover, a leap from place to place, an aim that never moved, everything at once.
//   npx tsx test/range.test.ts
import assert from 'node:assert/strict';
import { EYE, RangeJudge, STRIP, clearShot, figureAt, lookOf, rangeOf, type RangeSpec } from '../src/sim/range';
import { aimAt, playRange } from './range-player';

let checks = 0;
const ok = (what: string) => {
  checks++;
  console.log(`  ok  ${what}`);
};

const clear = clearShot;

// ---- the same for the same number, and fair and hard, a thousand times
{
  assert.deepEqual(rangeOf(12345), rangeOf(12345));
  assert.notDeepEqual(rangeOf(12345).cover, rangeOf(12346).cover);
  const none = new Set<number>();
  let fallbacks = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const spec = rangeOf(seed * 2654435761);
    if (spec.cover.length === 3 && spec.cover[0].x === 0 && spec.cover[0].z === -8) fallbacks++;
    let hiddenAtStart = 0;
    spec.figures.forEach((f, i) => {
      let fromStart = false, chances = 0;
      for (let k = 0; k < 16; k++) {
        const ms = k * 500;
        // (looked at more closely here than when it is dealt: more places, more moments)
        if (clear(spec, i, STRIP.start[0], STRIP.start[1], ms, none)) fromStart = true;
        for (let x = -STRIP.half + 1; x <= STRIP.half - 1; x += 1) for (const z of [1, 3, 5]) if (clear(spec, i, x, z, ms, none)) chances++;
      }
      void f;
      assert.ok(chances >= 24, `range ${seed}: figure ${i} is all but impossible to shoot (${chances} chances of 912)`);
      if (!fromStart) hiddenAtStart++;
    });
    assert.ok(hiddenAtStart >= 2, `range ${seed}: fewer than two figures are hidden from where the player starts`);
  }
  assert.ok(fallbacks < 5, `${fallbacks} of a thousand ranges are the plain one: the dealing is failing`);
  ok('a thousand ranges: each the same for its number, every figure fairly to be had, and two at least not to be had from the start');
}

/** the shared honest player (test/range-player.ts), saying what it says straight to a judge, with no clock but its own count */
const play = (spec: RangeSpec, judge: RangeJudge, how: { walk?: boolean; follow?: boolean; wait?: number } = {}) =>
  playRange(spec, { seen: (ms, x, z, yaw, pitch) => judge.seen(ms, x, z, yaw, pitch, ms + 60), shot: (ms, o, d) => void judge.shot(ms, o, d, ms + 65), down: () => judge.down, done: () => judge.passed, until: () => {} }, how);

// ---- somebody honest passes, on every range of two hundred
{
  let slowest = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const spec = rangeOf(seed * 40503 + 7), judge = new RangeJudge(spec);
    const took = await play(spec, judge);
    assert.ok(judge.passed, `range ${seed}: somebody who walked, looked and shot did not pass (${judge.down.size} of ${spec.need} down, last: ${judge.why || 'no reason'}, wrong ${judge.wrong})`);
    slowest = Math.max(slowest, took);
  }
  assert.ok(slowest < 40_000, `the slowest of them took ${(slowest / 1000).toFixed(0)} s`);
  ok(`two hundred ranges played by walking, turning, following and firing: all passed (the slowest in ${(slowest / 1000).toFixed(0)} s)`);
}

// ---- and what a program does without the walking, the looking or the waiting
{
  const spec = rangeOf(424242);
  const none = new Set<number>();
  // shots that are true to the range, with nothing said of where anybody stands
  {
    const judge = new RangeJudge(spec);
    let ms = 1000;
    for (let i = 0; i < spec.figures.length; i++) {
      for (let x = -9; x <= 9; x++) {
        if (clear(spec, i, x, 3, ms, none)) {
          const p = figureAt(spec.figures[i], ms), a = aimAt(x, 3, p.x, 1.2, p.z);
          judge.shot(ms, [x, EYE, 3], lookOf(a.yaw, a.pitch), ms + 50);
          break;
        }
      }
      ms += 400;
    }
    assert.equal(judge.down.size, 0, 'shots with nothing said of where the player stood were counted');
    assert.ok(!judge.passed);
  }
  // from the start, at what stands behind the cover: the range says no
  {
    const judge = new RangeJudge(spec);
    let landed = 0;
    for (let k = 0; k < 20; k++) judge.seen(k * 50, 0, 3, k * 0.01, 0, k * 50 + 50);
    spec.figures.forEach((f, i) => {
      const hidden = ![...Array(24).keys()].some((k) => clear(spec, i, 0, 3, (k / 24) * f.secs * 1000, none));
      if (!hidden) return;
      const p = figureAt(f, 1000), a = aimAt(0, 3, p.x, 1.2, p.z);
      if (judge.shot(1000 + i * 300, [0, EYE, 3], lookOf(a.yaw, a.pitch), 1100 + i * 300) >= 0) landed++;
    });
    assert.equal(landed, 0, 'a shot through the cover was counted');
  }
  // a leap from place to place, and everything else honest
  {
    const judge = new RangeJudge(spec);
    await play(spec, judge, { walk: false });
    assert.ok(!judge.passed, 'somebody who leapt from place to place passed');
    assert.ok(judge.wrong > 0, 'a leap across the strip was not seen for what it is');
  }
  // an aim that is simply right, having never moved
  {
    const judge = new RangeJudge(spec);
    await play(spec, judge, { follow: false });
    assert.ok(!judge.passed, `somebody whose aim never travelled passed (${judge.down.size} down)`);
  }
  // everything in the first half second
  {
    const judge = new RangeJudge(spec);
    for (let k = 0; k < 8; k++) judge.seen(k * 40, 0, 3, k * 0.02, 0, k * 40 + 30);
    spec.figures.forEach((f, i) => {
      const p = figureAt(f, 350 + i * 80), a = aimAt(0, 3, p.x, 1.2, p.z);
      judge.shot(350 + i * 80, [0, EYE, 3], lookOf(a.yaw, a.pitch), 420 + i * 80);
    });
    assert.equal(judge.down.size, 0, 'a figure was counted down before anybody could have seen it');
  }
  // a time from the future, three times: the go is over
  {
    const judge = new RangeJudge(spec);
    for (let k = 0; k < 3; k++) judge.seen(5000 + k, 0, 3, 0, 0, 1000);
    assert.ok(judge.failed(1000), 'a game that puts times to things that have not happened yet was let go on');
  }
  // and time itself: nobody passes by waiting
  assert.ok(new RangeJudge(spec).failed(spec.secs * 1000 + 2000));
  ok('not passed: shots with no player behind them, shots through the cover, a leap from place to place, an aim that never moved, everything at once');
}

console.log(`\n${checks} checks passed`);
