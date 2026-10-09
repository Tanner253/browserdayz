// Checks of the rules a broken leg is kept by (src/sim/injury.ts), and of the things that set
// one. No network, no world: `npx tsx test/injury.test.ts`.

import assert from 'node:assert/strict';
import { LEG, breaksOnHit, breaksOnLanding } from '../src/sim/injury';
import { ITEMS } from '../src/sim/items';
import { TYPES } from '../src/sim/economy';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

/** how fast somebody is going when they land from so many metres up */
const landing = (metres: number) => Math.sqrt(2 * 9.81 * metres);

ok('a drop from one storey never breaks a leg; from a tower it nearly always does', () => {
  // (a storey is about three metres: off a porch roof, out of an upstairs window)
  for (const roll of [0, 0.5, 0.999]) assert.equal(breaksOnLanding(landing(3.2), roll), false);
  for (const roll of [0, 0.5, 0.999]) assert.equal(breaksOnLanding(landing(5.5), roll), false, 'off a two-storey roof');
  // from seven metres it is a toss-up, more or less
  assert.equal(breaksOnLanding(landing(7.5), 0.1), true);
  assert.equal(breaksOnLanding(landing(7.5), 0.9), false);
  // and from the top of a watchtower it is certain
  for (const roll of [0, 0.5, 0.999]) assert.equal(breaksOnLanding(landing(11), roll), true);
  assert.equal(breaksOnLanding(LEG.fall[0], 0), false, 'at the very least of it, never');
});

ok('a bullet in the legs breaks one about half the time; anywhere else, never', () => {
  let shot = 0, blow = 0;
  const N = 2000;
  for (let k = 0; k < N; k++) {
    const roll = (k + 0.5) / N;
    if (breaksOnHit('legs', false, roll)) shot++;
    if (breaksOnHit('legs', true, roll)) blow++;
    assert.equal(breaksOnHit('torso', false, roll), false);
    assert.equal(breaksOnHit('head', false, roll), false);
    assert.equal(breaksOnHit(null, false, roll), false);
  }
  assert.ok(Math.abs(shot / N - LEG.shot) < 0.01);
  assert.ok(Math.abs(blow / N - LEG.blow) < 0.01);
  assert.ok(LEG.shot >= 0.3 && LEG.shot <= 0.7 && LEG.blow < LEG.shot);
});

ok('on a broken leg nobody outpaces anything: slower than a walk, and than the infected at a run', () => {
  assert.ok(LEG.limp < 1.7, 'a limp faster than a walk');
  assert.ok(LEG.limp >= 1.0, 'a limp so slow it is standing still');
  // (it knits by itself in the end, and not before the fight it was broken in is long over)
  assert.ok(LEG.knits >= 240 && LEG.knits <= 900);
});

ok('a splint sets it and so does a first aid kit; there are splints to be found, more of them than kits', () => {
  assert.ok(ITEMS.splint?.use?.splint, 'no splint, or it sets nothing');
  assert.ok(ITEMS.firstaid.use?.splint, 'a first aid kit does not set a leg');
  assert.ok(!ITEMS.bandage.use?.splint, 'the injector sets a leg');
  assert.ok(ITEMS.splint.use!.time >= 3 && ITEMS.splint.use!.time <= 8);
  assert.ok(TYPES.splint, 'splints are in no building');
  assert.ok(TYPES.splint.nominal > TYPES.firstaid.nominal);
  assert.ok(TYPES.splint.usage.includes('Medic'));
});

console.log(`\n${n} checks passed`);
