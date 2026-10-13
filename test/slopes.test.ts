// Checks of the rules for steep ground (src/sim/slopes.ts): that no slope is a wall, that going up is slower and
// dearer the steeper it is, that going down is slippery and then a slide, that a slide ends as a fall does, and that
// nothing in them moves a body over the ground faster than its own sprint (which is what the server holds feet to).
// No network, no world: `npx tsx test/slopes.test.ts`.

import assert from 'node:assert/strict';
import { LEGS, SLIDE, SLOPE, degOf, legs, paceUp, riseOf, slideFall, slideGoesOn, slideJolt, slideOn, slideTop, type Body } from '../src/sim/slopes';
import { LEG, breaksOnLanding } from '../src/sim/injury';
import { LOAD, paceOf, runCost } from '../src/sim/load';
import { MAX_STAMINA } from '../src/net/protocol';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

/** as the survivor's body has them (src/game/player.ts): a jog, a sprint, a sprint with empty hands; what pulls a body down; and the landing that first hurts */
const JOG = 4, SPRINT = 6.2, BARE = 6.2 * 1.2, GRAVITY = 9.81 * 1.35, HURTS = 9.5;
/** the fastest the server lets anybody go on their own legs, metres a second over the ground (CHECK.foot in server/index.ts) */
const SERVER_FOOT = 9.5;
const WAYS = [1, 0.9, 0.7, 0.5, 0.3, 0.1, 0];
const BODIES: Body[] = [{}, { low: true }, { broken: true }, { kg: 30 }, { kg: 90 }, { kg: 90, broken: true }];

/** a slide from rest down an even face: how fast along the slope after so many metres of it */
function slid(deg: number, metres: number, low = false): number {
  const rise = riseOf(deg), h = 1 / 60;
  let v = 0, gone = 0;
  for (let k = 0; k < 60 * 120 && gone < metres; k++) {
    v = slideOn(v, rise, h, low, GRAVITY);
    gone += v * h;
  }
  return v;
}

ok('an ordinary hillside is nothing to the legs: under 33 degrees every answer is the answer on the level', () => {
  for (let d = 0; d < SLOPE.steep; d += 0.5) {
    for (const up of [1, 0.4, 0, -0.4, -1]) {
      for (const body of [...BODIES, { winded: true }]) {
        const l = legs(riseOf(d), up, body);
        assert.equal(l.pace, Infinity, `${d} degrees holds a pace back`);
        assert.deepEqual([l.carried, l.runsOn, l.brake, l.drift, l.cost, l.cling], [1, 0, 1, 0, 0, 0]);
        assert.ok(l.sprint && l.jump && !l.hands && !l.slides);
      }
    }
    assert.equal(paceUp(riseOf(d)), Infinity);
  }
});

ok('never a wall: with breath, every way up every slope there is has a pace, for every kind of body', () => {
  // (the steepest face on the map is 76 degrees; asked here up to 89)
  for (let d = SLOPE.steep; d <= 89; d += 0.5) {
    for (const up of WAYS) {
      for (const body of BODIES) {
        const l = legs(riseOf(d), up, body);
        assert.ok(!l.slides, `${d} degrees, going ${up} up it, will not be stood on`);
        assert.ok(l.pace >= 0.2, `${d} degrees is as good as a wall to ${JSON.stringify(body)}: ${l.pace} m/s`);
      }
    }
  }
  // (out of breath, a scramble is still got up, slowly; only a climb is not held)
  for (let d = SLOPE.steep; d < SLOPE.climb; d += 1) {
    const l = legs(riseOf(d), 1, { winded: true });
    assert.ok(!l.slides && l.pace >= 0.4, `out of breath, ${d} degrees cannot be got up`);
  }
  for (let d = SLOPE.climb; d <= 89; d += 1) assert.ok(legs(riseOf(d), 1, { winded: true }).slides, `out of breath, ${d} degrees is held`);
});

ok('going up is slower the steeper it is: a jog is whole to 42 degrees, a sprint is no faster than a jog from there', () => {
  let was = Infinity;
  for (let d = SLOPE.steep; d <= 89; d += 0.25) {
    const l = legs(riseOf(d), 1);
    assert.ok(l.pace <= was + 1e-9, `${d} degrees is quicker to climb than ground less steep`);
    was = l.pace;
    if (d <= 42) assert.ok(l.pace >= JOG, `a jog is held back at ${d} degrees`);
    if (d >= 42.5) assert.ok(!l.sprint, `a sprint is begun up ${d} degrees`);
    // (a sprint that is begun is always worth beginning, and one that is not would have been no faster than a jog and a tenth)
    assert.equal(l.sprint, d < SLOPE.scramble && l.pace >= LEGS.sprint);
  }
  assert.ok(legs(riseOf(36), 1).pace < SPRINT + 0.6 && legs(riseOf(36), 1).sprint, 'a sprint is not yet slowed at 36 degrees, or is not let begin');
  // (what the table in the report says, near enough: 45, 50, 60, 70 degrees)
  for (const [d, lo, hi] of [[45, 3, 3.4], [50, 1.8, 2.2], [60, 1, 1.2], [70, 0.55, 0.75], [76, 0.45, 0.55], [85, 0.45, 0.55]]) {
    const p = legs(riseOf(d), 1).pace;
    assert.ok(p >= lo && p <= hi, `${d} degrees goes at ${p} m/s`);
  }
});

ok('a face taken at a slant is a gentler climb, and gains height faster than going straight at it', () => {
  for (const d of [50, 55, 58]) {
    const rise = riseOf(d), straight = legs(rise, 1), slant = legs(rise, Math.cos(Math.PI / 4));
    assert.ok(slant.pace > straight.pace, `${d} degrees is no quicker taken at a slant`);
    // (height gained a second: the pace along the way, by how steep the way is)
    const gain = (pace: number, up: number) => pace * Math.sin(Math.atan(rise * up));
    assert.ok(gain(slant.pace, Math.cos(Math.PI / 4)) > gain(straight.pace, 1), `${d} degrees: hairpins gain nothing`);
  }
  // (and straight across a face is never slower than straight up it)
  for (let d = SLOPE.steep; d <= 80; d += 1) assert.ok(legs(riseOf(d), 0).pace >= legs(riseOf(d), 1).pace);
});

ok('steep ground costs breath, more the steeper; from 50 degrees it is hands and feet, with no sprint and no jump', () => {
  let was = 0;
  for (let d = SLOPE.steep; d <= 80; d += 0.5) {
    const l = legs(riseOf(d), 1);
    assert.ok(l.cost >= was - 1e-9, `${d} degrees is cheaper than ground less steep`);
    was = l.cost;
    assert.equal(l.hands, d >= SLOPE.scramble);
    assert.equal(l.jump, d < SLOPE.scramble);
    assert.equal(l.cling > 0, d >= SLOPE.climb, `${d} degrees: hanging on`);
    // (going down costs nothing; going across a scramble costs what the face costs)
    assert.equal(legs(riseOf(d), -1).cost, 0);
    if (d >= SLOPE.scramble) assert.ok(legs(riseOf(d), 0).cost >= l.cost - 1e-9);
    else assert.equal(legs(riseOf(d), 0).cost, 0);
  }
  // a full breath is a long way up a hillside and a short way up a cliff
  const secs = (d: number) => MAX_STAMINA / legs(riseOf(d), 1).cost, height = (d: number) => secs(d) * legs(riseOf(d), 1).pace * Math.sin((d * Math.PI) / 180);
  assert.ok(height(45) > 80, `a breath is only ${height(45).toFixed(0)} m up 45 degrees`);
  assert.ok(height(60) > 10 && height(60) < 30, `a breath is ${height(60).toFixed(0)} m up 60 degrees`);
  assert.ok(height(70) > 4 && height(70) < 12, `a breath is ${height(70).toFixed(0)} m up 70 degrees`);
  assert.ok(secs(70) >= 8, 'a climb is over before it is begun');
  // out of breath nothing more is taken, so it comes back as the body goes on
  assert.equal(legs(riseOf(55), 1, { winded: true }).cost, 0);
  assert.ok(Math.abs(legs(riseOf(55), 1, { winded: true }).pace - legs(riseOf(55), 1).pace * LEGS.spent) < 1e-9);
});

ok('a load is one rule everywhere: what it does to a sprint on the level it does to a climb', () => {
  for (const kg of [0, LOAD.free, 20, 35, 60, 90]) {
    for (const d of [40, 48, 55, 65]) {
      const bare = legs(riseOf(d), 1), under = legs(riseOf(d), 1, { kg });
      assert.ok(Math.abs(under.cost - bare.cost * runCost(kg)) < 1e-9, `${kg} kg up ${d} degrees costs ${under.cost}`);
      assert.ok(Math.abs(under.pace - bare.pace * paceOf(kg)) < 1e-9, `${kg} kg up ${d} degrees goes at ${under.pace}`);
    }
  }
  // (and a broken leg is slower and dearer than a whole one, on every slope)
  for (let d = 43; d <= 80; d += 1) {
    const whole = legs(riseOf(d), 1), lame = legs(riseOf(d), 1, { broken: true });
    assert.ok(lame.pace < whole.pace && lame.cost > whole.cost && lame.pace >= 0.25);
  }
});

ok('going down is slippery: carried faster than a walk, hard to stop, then not to be stopped but on a knee or by turning across', () => {
  let carried = 1, brake = 1, runs = 0;
  for (let d = SLOPE.steep; d < SLOPE.scramble; d += 0.5) {
    const l = legs(riseOf(d), -1);
    assert.ok(l.carried >= carried && l.brake <= brake && l.runsOn >= runs, `${d} degrees is less slippery than ground less steep`);
    [carried, brake, runs] = [l.carried, l.brake, l.runsOn];
    assert.equal(l.pace, Infinity, 'going straight down is held back');
    assert.ok(!l.slides && !l.hands && l.cost === 0);
    assert.equal(l.runsOn > 0, d > SLOPE.carried, `${d} degrees: runs on`);
    // (never carried faster than a sprint is: the body's own sprint is the limit, and that is the game's to hold: see player.ts)
    assert.ok(l.carried <= 1.36 && JOG * l.carried < BARE);
    // down on a knee nothing runs away with a body, and it stops twice as well
    const low = legs(riseOf(d), -1, { low: true });
    assert.equal(low.runsOn, 0);
    assert.ok(low.brake >= l.brake);
    // across the face it is not carried on, only down it a little
    assert.equal(legs(riseOf(d), 0).carried, 1);
  }
  assert.ok(carried > 1.3 && brake < 0.2 && runs > 2, 'at the edge of a scramble the ground is hardly slippery at all');
  // from 50 degrees there is no footing going down at all, for anybody
  for (let d = SLOPE.scramble; d <= 89; d += 1) for (const body of [...BODIES, { winded: true }]) assert.ok(legs(riseOf(d), -1, body).slides, `${d} degrees is walked down`);
  // (but a body going across such a face, or a little down it, is not thrown off it)
  assert.ok(!legs(riseOf(55), -0.3).slides && legs(riseOf(55), -0.5).slides);
});

ok('a slide gathers pace with the drop, crouching slows it, and it ends where the ground eases', () => {
  for (const d of [50, 55, 60, 65, 70, 76]) {
    assert.ok(slid(d, 1) < slid(d, 5) && slid(d, 5) <= slid(d, 40), `${d} degrees: no faster for the drop`);
    assert.ok(slid(d, 40, true) < slid(d, 40) * 0.6, `${d} degrees: crouching does not slow it`);
    assert.ok(Math.abs(slid(d, 200) - slideTop(riseOf(d))) < 1e-6, 'a long slide does not reach its top speed');
    assert.ok(slideGoesOn(0, riseOf(d)), 'a slide ends where there is no footing');
  }
  // crouched, a slide begun on a scramble is brought to a stop on ground of 44 degrees; standing it runs on to 40
  let v = slideTop(riseOf(60));
  for (let k = 0; k < 60 * 6; k++) v = slideOn(v, riseOf(44), 1 / 60, true, GRAVITY);
  assert.ok(v < SLIDE.stops && !slideGoesOn(v, riseOf(44)), `dug in on 44 degrees it still goes ${v}`);
  assert.ok(slideGoesOn(8, riseOf(41)) && !slideGoesOn(8, riseOf(39)) && !slideGoesOn(8, riseOf(20)));
  // digging the heels in slows a slide by degrees, not at a blow
  const fast = slideTop(riseOf(65)), dug = slideOn(fast, riseOf(65), 1 / 60, true, GRAVITY);
  assert.ok(dug < fast && dug > fast * 0.9);
});

ok('no slide goes over the ground faster than a sprint, whatever it comes down and whatever it comes onto', () => {
  let most = 0;
  for (let from = SLOPE.holds; from <= 89; from += 1) {
    // as fast as that face can make it, and then onto every other ground a slide can go on over
    const v = slid(from, 300);
    assert.ok(v <= SLIDE.most + 1e-9);
    for (let onto = SLOPE.holds; onto <= 89; onto += 1) {
      for (const low of [false, true]) {
        const after = slideOn(v, riseOf(onto), 1 / 60, low, GRAVITY);
        most = Math.max(most, after / Math.hypot(1, riseOf(onto)));
      }
    }
  }
  assert.ok(most <= SLIDE.level + 1e-9, `a slide goes over the ground at ${most} m/s`);
  assert.ok(SLIDE.level < SPRINT, 'a slide is a faster way to travel than a sprint');
  // worked sideways as hard as it can be, it is still slower than a sprint with empty hands, which the server has always let pass
  const worst = Math.hypot(SLIDE.level, SLIDE.steer);
  assert.ok(worst < BARE && worst < SERVER_FOOT - 2, `a steered slide goes ${worst} m/s over the ground`);
  // and nothing the legs do on steep ground is asked for faster than the body's own sprint (carried downhill is held to it in player.ts)
  for (let d = SLOPE.steep; d < SLOPE.scramble; d += 1) assert.ok(SPRINT * 1 <= BARE && legs(riseOf(d), -1).drift === 0);
});

ok('a slide that ends is a landing: nothing for a short one or a gentle one, a leg for a long one down a cliff', () => {
  /** how fast the body is coming down at the foot of an even face */
  const lands = (d: number, metres: number, low = false) => slideFall(slid(d, metres, low), riseOf(d));
  // a controlled descent hurts nobody: any face crouched, any short slide, any long one under 57 degrees
  for (let d = SLOPE.holds; d <= 80; d += 1) {
    assert.ok(lands(d, 300, true) < HURTS, `crouched down ${d} degrees lands at ${lands(d, 300, true)}`);
    assert.ok(lands(d, 3) < HURTS, `three metres of ${d} degrees lands at ${lands(d, 3)}`);
    if (d <= 57) assert.ok(lands(d, 300) < HURTS, `${d} degrees lands at ${lands(d, 300)}`);
  }
  // sixty degrees and thirty metres of it: it hurts, and no leg is broken
  assert.ok(lands(60, 30) > HURTS && lands(60, 30) < LEG.fall[0]);
  // sixty-five: a leg may go; seventy: it goes
  assert.ok(breaksOnLanding(lands(65, 30), 0) && !breaksOnLanding(lands(65, 30), 0.99));
  assert.ok(breaksOnLanding(lands(70, 30), 0.99));
  // and none of them is death by itself from whole (the rule is 14 of health for every metre a second over what first hurts)
  for (let d = SLOPE.holds; d <= 89; d += 1) assert.ok((lands(d, 500) - HURTS) * 14 < 100, `${d} degrees kills outright`);
});

ok('ground that eases under a slide takes the difference at a blow; ground that steepens takes nothing', () => {
  const v65 = slideTop(riseOf(65)), fall65 = slideFall(v65, riseOf(65));
  // onto steeper ground, or the same: nothing
  assert.equal(slideJolt(fall65, v65, riseOf(65)), 0);
  assert.equal(slideJolt(fall65, v65, riseOf(72)), 0);
  // onto ground a little easier: little; a cliff onto the gentlest ground a slide goes on over: nearly all of it
  assert.ok(slideJolt(fall65, v65, riseOf(62)) > 0 && slideJolt(fall65, v65, riseOf(62)) < 2.5);
  const v75 = slideTop(riseOf(75)), fall75 = slideFall(v75, riseOf(75));
  assert.ok(slideJolt(fall75, v75, riseOf(41)) > HURTS);
  // and by degrees it never comes to a blow that hurts: 70 down to 40 in steps of five
  let v = slideTop(riseOf(70)), fall = slideFall(v, riseOf(70));
  for (let d = 65; d >= 40; d -= 5) {
    const jolt = slideJolt(fall, v, riseOf(d));
    assert.ok(jolt < HURTS, `easing to ${d} degrees is a blow of ${jolt}`);
    v = Math.min(v, slideTop(riseOf(d)));
    fall = slideFall(v, riseOf(d));
  }
});

ok('the infected are slowed by the same figures', () => {
  for (let d = 0; d <= 85; d += 1) {
    const p = paceUp(riseOf(d)), l = legs(riseOf(d), 1);
    assert.equal(p, l.pace, `${d} degrees`);
  }
  assert.equal(paceUp(-0.8), Infinity, 'going down slows them');
  assert.ok(Math.abs(degOf(riseOf(37)) - 37) < 1e-9);
});

console.log(`\n${n} checks passed`);
