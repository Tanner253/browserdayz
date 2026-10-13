// Blood, which is not health (src/sim/blood.ts): the rules the game and the server both go by, held to what was
// asked (2026-10-13: "a new mechanic for blood, that is seprate from health like dayz ... a player who is bleeding
// out with low hp dies too fast after a gunfight"; "we need blood bags with iv's now to recover blood faster") and
// to DayZ's own figures, which are what it is built on.   npx tsx test/blood.test.ts

import assert from 'node:assert/strict';
import { BLOOD, bleedOf, bleedsOutIn, bloodBack, bloodLeft, bloodOf, greyOf, mendsOn, withWound, woundOf } from '../src/sim/blood';
import { TYPES } from '../src/sim/economy';
import { ITEMS } from '../src/sim/items';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

/** somebody left to bleed, a second at a time: how long they last, and what they are left with if they live */
const left = (wounds: number[], blood = BLOOD.full) => {
  let bleed = 0;
  for (const w of wounds) bleed = withWound(bleed, w);
  for (let t = 1; t <= BLOOD.clots; t++) {
    blood -= bleed;
    if (blood <= BLOOD.dead) return { dead: t, blood };
  }
  return { dead: 0, blood };
};

ok('the figures are DayZ\'s: five litres, dead at half; six a second from the body, 3.6 from a limb; a hundred for a round; five minutes to close', () => {
  assert.deepEqual([BLOOD.full, BLOOD.dead, BLOOD.shot, BLOOD.clots], [5000, 2500, 100, 300]);
  assert.deepEqual([woundOf('shot', 'head'), woundOf('shot', 'torso'), woundOf('shot', 'arms'), woundOf('shot', 'legs')], [6, 6, 3.6, 3.6]);
  // (a round that went in nobody knows where went into the body)
  assert.equal(woundOf('shot', 'nowhere'), 6);
  // (and what is not a round bleeds by what it was: a blade as a round in a limb, teeth less, a blow least)
  assert.ok(woundOf('cut') === 3.6 && woundOf('bite') < woundOf('cut') && woundOf('blunt') < woundOf('bite') && woundOf('blast') === 6);
});

ok('nobody dies of one wound, and nobody is well after it; two kill in minutes, not seconds; and wounds bleed no faster than three together', () => {
  // (one in the body, left alone: 1800 of the 2500 there are to lose)
  const one = left([woundOf('shot', 'torso')]);
  assert.equal(one.dead, 0, 'one wound killed');
  assert.ok(Math.abs(one.blood - 3200) < 1 && one.blood < BLOOD.grey[1] && one.blood > BLOOD.faint, `one wound leaves ${one.blood}`);
  // (one in a leg: a good deal less)
  assert.ok(left([woundOf('shot', 'legs')]).blood > 3900);
  // (two in the body: three minutes and a half. It was thirty seconds, for whoever came out of a fight on thirty health.)
  const two = left([6, 6]);
  assert.ok(two.dead > 200 && two.dead < 215, `two wounds kill in ${two.dead} s`);
  const three = left([6, 6, 6]);
  assert.ok(three.dead > 130 && three.dead < 145, `three wounds kill in ${three.dead} s`);
  // (and a fourth, a fifth, a tenth change nothing: there is only so fast anybody bleeds)
  assert.equal(left([6, 6, 6, 6, 6, 3.6, 3.6]).dead, three.dead);
  assert.equal(withWound(17, 6), BLOOD.most);
  // (how long somebody has, said beforehand: the same sum)
  assert.equal(bleedsOutIn(BLOOD.full, 6), Infinity);
  assert.ok(Math.abs(bleedsOutIn(BLOOD.full, 12) - two.dead) <= 1);
  assert.equal(bleedsOutIn(BLOOD.full, 0), Infinity);
  // (somebody already short of blood does die of one)
  assert.ok(left([6], 4000).dead > 0);
});

ok('the colour goes as it is lost, and below three litres the head swims; health mends only on good blood', () => {
  assert.deepEqual([greyOf(5000), greyOf(4500), greyOf(3500), greyOf(2600)], [0, 0, 1, 1]);
  assert.ok(greyOf(4000) > 0.4 && greyOf(4000) < 0.6);
  assert.equal(BLOOD.faint, 3000);
  assert.deepEqual([mendsOn(5000), mendsOn(4500), mendsOn(4000), mendsOn(3400)], [1, 1, 0.5, 0]);
  // (what the bar shows: all of it down to none, over what can be lost)
  assert.deepEqual([bloodLeft(5000), bloodLeft(3750), bloodLeft(2500), bloodLeft(1000)], [1, 0.5, 0, 0]);
});

ok('it comes back by itself to whoever is fed and watered, slowly; not on an empty stomach, and not while a wound is open', () => {
  assert.equal(bloodBack(80, 80, false), BLOOD.back[0]);
  assert.equal(bloodBack(80, 40, false), BLOOD.back[1]);
  assert.equal(bloodBack(40, 80, false), BLOOD.back[1]);
  assert.equal(bloodBack(80, 15, false), 0);
  assert.equal(bloodBack(10, 80, false), 0);
  assert.equal(bloodBack(100, 100, true), 0);
  // (a litre in about a quarter of an hour, fed: four times as fast as DayZ gives it, and still no way to get back into a fight)
  const mins = 1000 / BLOOD.back[0] / 60;
  assert.ok(mins > 10 && mins < 20, `a litre comes back in ${mins.toFixed(0)} minutes`);
});

ok('a bag puts it back faster: saline slowly, blood quickly; neither closes a wound; they are kept in clinics and the hospital', () => {
  const saline = ITEMS.saline.use!, bag = ITEMS.blood_bag.use!;
  assert.ok(saline.blood! >= 500 && bag.blood! > saline.blood! && bag.blood! <= BLOOD.full - BLOOD.dead);
  // (many times what comes back by itself)
  assert.ok(saline.blood! / saline.over! > BLOOD.back[0] * 5 && bag.blood! / bag.over! > (saline.blood! / saline.over!) * 5);
  assert.ok(!saline.stopBleed && !bag.stopBleed && !saline.health && !bag.health, 'a bag closes a wound, or mends');
  // (and what closes a wound in a moment gives no blood: the two are two things)
  for (const id of ['bandage', 'stim', 'stim_combat']) assert.ok(ITEMS[id].use!.stopBleed && !ITEMS[id].use!.blood, id);
  // (the kit and the pouch each run in a little, 2026-10-13: "medkit should recover some blood for the user but
  // bloodbags are superiour source of blood": less than a bag of saline, and a bag of blood gives three times as
  // much, many times as fast)
  for (const id of ['firstaid', 'aid_pouch']) {
    const u = ITEMS[id].use!;
    assert.ok(u.stopBleed && u.blood! > 0 && u.blood! < saline.blood! && bag.blood! >= u.blood! * 3 && bag.blood! / bag.over! > (u.blood! / u.over!) * 5, id);
  }
  for (const id of ['saline', 'blood_bag']) {
    assert.ok(TYPES[id], `${id} is kept nowhere`);
    assert.equal(TYPES[id].at[0], 0, `${id} on the outskirts`);
    assert.ok(TYPES[id].usage.includes('Hospital') && TYPES[id].usage.includes('Medic'));
  }
  assert.ok(TYPES.blood_bag.at[2] > TYPES.blood_bag.at[1] * 3, 'blood is not the hospital\'s before anywhere');
});

ok('what a game or a save from before there was blood says of it: all of it, and one wound if it was bleeding', () => {
  assert.equal(bloodOf({}), BLOOD.full);
  assert.equal(bloodOf(null), BLOOD.full);
  assert.equal(bloodOf({ blood: 3100 }), 3100);
  assert.equal(bloodOf({ blood: 9e9 }), BLOOD.full);
  assert.equal(bloodOf({ blood: -5 }), 0);
  assert.equal(bloodOf({ blood: 'lots' }), BLOOD.full);
  assert.equal(bleedOf({ bleeding: true }), 6);
  assert.equal(bleedOf({ bleeding: false }), 0);
  assert.equal(bleedOf({ bleed: 9.6, bleeding: true }), 9.6);
  assert.equal(bleedOf({ bleed: 400 }), BLOOD.most);
});

console.log(`${n} checks passed`);
