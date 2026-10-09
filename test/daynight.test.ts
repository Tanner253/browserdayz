// Checks of the day's clock (src/sim/daynight.ts). `npx tsx test/daynight.test.ts`.

import assert from 'node:assert/strict';
import { DAY, clockAt, hourAt, phaseOf, untilDawn, untilNight } from '../src/sim/daynight';
import { TAG_HOLD_MIN } from '../src/sim/items';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

ok('a day is thirty-two minutes, a quarter of it night, and the dark is shorter than a dog tag has to be held', () => {
  assert.equal(DAY.length, 1920);
  assert.equal(DAY.night, 0.75);
  let night = 0, day = 0;
  for (let s = 0; s < DAY.length; s++) {
    const h = hourAt(phaseOf(s));
    if (h.night) night++;
    if (h.light === 1) day++;
  }
  assert.equal(night, 480);
  assert.ok(day >= 1280 && day <= 1290, `${day} s of full day`);
  // (dark: night, and the darker half of dusk and of first light)
  let dark = 0;
  for (let s = 0; s < DAY.length; s++) if (hourAt(phaseOf(s)).light < 0.5) dark++;
  assert.ok(dark < TAG_HOLD_MIN * 60, `${dark} s of dark against ${TAG_HOLD_MIN} minutes to hold a tag`);
});

ok('the light comes and goes without a jump, and the sun is low only while it does', () => {
  let last = hourAt(0).light;
  for (let k = 1; k <= 4000; k++) {
    const h = hourAt(k / 4000);
    assert.ok(Math.abs(h.light - last) < 0.02, `a jump of ${Math.abs(h.light - last)} at ${k / 4000}`);
    assert.ok(h.light >= 0 && h.light <= 1 && h.low >= 0 && h.low <= 1);
    if (h.light === 1 || h.light === 0) assert.ok(h.low < 0.05);
    last = h.light;
  }
  assert.ok(hourAt((DAY.dusk + DAY.night) / 2).low > 0.99);
  assert.ok(hourAt(DAY.day / 2).low > 0.99);
});

ok('the hour runs on from any moment, and comes round', () => {
  assert.ok(Math.abs(phaseOf(DAY.length * 7 + DAY.length / 4) - 0.25) < 1e-9);
  assert.ok(Math.abs(phaseOf(-DAY.length / 4) - 0.75) < 1e-9);
  assert.equal(hourAt(1.3).light, hourAt(0.3).light);
  assert.equal(hourAt(-0.1).night, true);
});

ok('a clock says it as a clock would', () => {
  assert.equal(clockAt(0), '05:30');
  assert.equal(clockAt(DAY.day), '06:30');
  assert.equal(clockAt(DAY.dusk), '19:30');
  assert.equal(clockAt(DAY.night), '20:30');
  assert.equal(clockAt((DAY.night + 1) / 2), '01:00');
  assert.ok(Math.abs(untilNight(0.5) - 0.25 * DAY.length) < 1e-6);
  assert.ok(Math.abs(untilNight(0.8) - 0.95 * DAY.length) < 1e-6);
  assert.ok(Math.abs(untilDawn(0.9) - 0.1 * DAY.length) < 1e-6);
});

console.log(`\n${n} checks passed`);
