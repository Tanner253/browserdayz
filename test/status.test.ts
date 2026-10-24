// How a survivor's state is read off the screen (src/ui/status.ts): which of its five looks each symbol has, how
// many arrows stand beside it, when blood is shown at all, and which badges are up.   npx tsx test/status.test.ts

import assert from 'node:assert/strict';
import { BLOOD, bloodBack, greyOf, mendsOn } from '../src/sim/blood';
import { FIRE } from '../src/sim/fires';
import { GAS } from '../src/sim/gas';
import { ITEMS } from '../src/sim/items';
import { NEED, stage } from '../src/sim/wells';
import { FED, HEALTH, PACE, Pace, STATS, arrowsOf, bleedLevel, bloodShows, fillOf, reading, stepOf, type Body, type Stat } from '../src/ui/status';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const well: Body = { health: 100, blood: BLOOD.full, bleed: 0, energy: 85, water: 85, broken: false, drip: false, gas: null, fire: null, ill: 0, guard: 0 };
const still: Record<Stat, number> = { health: 0, blood: 0, food: 0, water: 0 };
const read = (b: Partial<Body>, rates: Partial<Record<Stat, number>> = {}) => reading({ ...well, ...b }, { ...still, ...rates });
const stat = (r: ReturnType<typeof reading>, s: Stat) => r.stats.find((x) => x.stat === s)!;

ok('food and water change their look where the rules change what they do', () => {
  for (const s of ['food', 'water'] as Stat[]) {
    assert.equal(stepOf(s, 100), 'fine');
    assert.equal(stepOf(s, FED + 0.1), 'fine');
    assert.equal(stepOf(s, FED), 'less');
    assert.equal(stepOf(s, NEED.wanting), 'less');
    assert.equal(stepOf(s, NEED.wanting - 0.1), 'low');
    assert.equal(stepOf(s, NEED.bad), 'low');
    assert.equal(stepOf(s, NEED.bad - 0.1), 'crit');
    assert.equal(stepOf(s, 0.1), 'crit');
    assert.equal(stepOf(s, 0), 'last');
  }
  // yellow is the rules' first want and red their second, to the same figure
  for (let v = 0.5; v <= 100; v += 0.5) {
    const look = stepOf('food', v);
    assert.equal(look === 'low', stage(v) === 1, `food at ${v}`);
    assert.equal(look === 'crit', stage(v) === 2, `food at ${v}`);
  }
  // and the line between whole and less is where blood stops coming back at its best
  assert.equal(bloodBack(FED + 0.1, 100, false), BLOOD.back[0]);
  assert.equal(bloodBack(FED, 100, false), BLOOD.back[1]);
});

ok('blood changes its look where the colour goes, where health stops mending, and where the head swims', () => {
  assert.equal(stepOf('blood', BLOOD.full), 'fine');
  assert.equal(stepOf('blood', BLOOD.full - 1), 'less');
  assert.equal(stepOf('blood', BLOOD.grey[0]), 'less');
  assert.equal(stepOf('blood', BLOOD.grey[0] - 1), 'low');
  assert.equal(stepOf('blood', BLOOD.grey[1]), 'low');
  assert.equal(stepOf('blood', BLOOD.grey[1] - 1), 'crit');
  assert.equal(stepOf('blood', BLOOD.faint), 'crit');
  assert.equal(stepOf('blood', BLOOD.faint - 1), 'last');
  for (let b = BLOOD.dead; b <= BLOOD.full; b += 50) {
    const look = stepOf('blood', b);
    // white for as long as nothing has changed for the survivor, and never after
    assert.equal(look === 'fine' || look === 'less', greyOf(b) === 0 && mendsOn(b) === 1, `blood at ${b}`);
    // red (or blinking) exactly when health no longer mends on it
    assert.equal(look === 'crit' || look === 'last', mendsOn(b) === 0, `blood at ${b}`);
  }
});

ok('health: less, yellow, red where a survivor is slowed, and blinking where the lightest blow ends it', () => {
  assert.deepEqual([100, 80, 79, 50, 49, 30, 29, 15, 14, 1].map((v) => stepOf('health', v)), ['fine', 'fine', 'less', 'less', 'low', 'low', 'crit', 'crit', 'last', 'last']);
  assert.equal(HEALTH.slow, 30);
  // (what one of the infected does, and a fist: src/sim/combat.ts)
  for (const blow of [13, 14]) assert.equal(stepOf('health', blow), 'last');
});

ok('the symbol is as full as what it stands for: blood by what can still be lost', () => {
  assert.equal(fillOf('health', 100), 1);
  assert.equal(fillOf('food', 25), 0.25);
  assert.equal(fillOf('water', -3), 0);
  assert.equal(fillOf('blood', BLOOD.full), 1);
  assert.equal(fillOf('blood', BLOOD.dead), 0);
  assert.equal(fillOf('blood', (BLOOD.full + BLOOD.dead) / 2), 0.5);
});

ok('arrows: none when steady, one to three by how fast, by the rates the rules have', () => {
  for (const s of STATS) {
    assert.equal(arrowsOf(s, 0), 0);
    assert.ok(PACE[s].down[0] < PACE[s].down[1] && PACE[s].down[1] < PACE[s].down[2]);
    assert.ok(PACE[s].up[0] < PACE[s].up[1] && PACE[s].up[1] < PACE[s].up[2]);
  }
  // a wound in a limb, one in the body, two in the body, and as fast as anybody bleeds; and none of them is told
  // differently for being measured a hair under what it is (every wound costs a multiple of 1.2: no line is on one)
  for (let r = 1.2; r <= BLOOD.most + 0.01; r += 1.2) assert.equal(arrowsOf('blood', -r * 0.99), arrowsOf('blood', -r * 1.01), `a wound of ${r.toFixed(1)}`);
  assert.equal(arrowsOf('blood', -BLOOD.blunt), -1);
  assert.equal(arrowsOf('blood', -BLOOD.wound.arms), -1);
  assert.equal(arrowsOf('blood', -BLOOD.wound.torso), -2);
  assert.equal(arrowsOf('blood', -2 * BLOOD.wound.torso), -3);
  assert.equal(arrowsOf('blood', -BLOOD.most), -3);
  // back by itself, from a bag of saline, from a bag of blood
  assert.equal(arrowsOf('blood', BLOOD.back[1]), 1);
  assert.equal(arrowsOf('blood', BLOOD.back[0]), 1);
  const bag = (id: string) => ITEMS[id].use!.blood! / ITEMS[id].use!.over!;
  assert.equal(arrowsOf('blood', bag('saline')), 2);
  assert.equal(arrowsOf('blood', bag('aid_pouch')), 2);
  assert.equal(arrowsOf('blood', bag('blood_bag')), 3);
  // and a bag of blood running into somebody who is bleeding as fast as can be is still three, up
  assert.equal(arrowsOf('blood', bag('blood_bag') - BLOOD.most), 3);
  // health: starving (0.35 a second), the gas at its edge and its middle; mending by itself, on poor blood, by a fire
  assert.equal(arrowsOf('health', -0.35), -1);
  assert.equal(arrowsOf('health', -GAS.damage[0]), -2);
  assert.equal(arrowsOf('health', -GAS.damage[1]), -3);
  assert.equal(arrowsOf('health', 0.12), 1);
  assert.equal(arrowsOf('health', 0.06), 1);
  assert.equal(arrowsOf('health', FIRE.heal), 2);
  // food and water: nothing at rest or at a walk (NEED.hunger and NEED.thirst a second, 1.3 times that walking), one at a run (1.8 times) and a sprint (2.4)
  for (const [stat, rate] of [['food', NEED.hunger], ['water', NEED.thirst]] as [Stat, number][]) {
    assert.equal(arrowsOf(stat, -rate), 0);
    assert.equal(arrowsOf(stat, -rate * 1.3), 0);
    assert.equal(arrowsOf(stat, -rate * 1.8), -1);
    assert.equal(arrowsOf(stat, -rate * 2.4), -1);
  }
  // (water a quarter slower than it was: the owner, 2026-10-23)
  assert.equal(NEED.thirst, 0.07 * 0.75);
});

ok('how fast a thing is changing is told from what it was a few seconds ago', () => {
  // a wound in the body, sixty times a second: nothing for half a second, then what it costs
  let p = new Pace(), v = 5000, rate = 0;
  for (let f = 0; f <= 60 * 5; f++) {
    rate = p.note((v = 5000 - 6 * (f / 60)), f / 60);
    if (f / 60 < 0.45) assert.equal(rate, 0);
    if (f / 60 > 0.6) assert.ok(Math.abs(rate + 6) < 0.01, `${rate} at ${f / 60}s`);
  }
  // dressed: within four seconds the arrow is gone
  for (let f = 1; f <= 60 * 4; f++) rate = p.note(v, 5 + f / 60);
  assert.equal(rate, 0);
  // a blow of thirty all at once is three arrows down for about three seconds, and then nothing
  p = new Pace();
  const seen: number[] = [];
  for (let f = 0; f <= 60 * 9; f++) seen.push(arrowsOf('health', p.note(f / 60 < 2 ? 100 : 70, f / 60)));
  assert.equal(seen[60 * 1], 0);
  assert.equal(seen[60 * 2 + 30], -3);
  assert.equal(seen[60 * 4 + 30], -3);
  assert.equal(seen[60 * 6], 0);
  // nothing heard for longer than is measured over (the page was hidden): what was known is let go
  p = new Pace();
  p.note(100, 0);
  p.note(100, 1);
  assert.equal(p.note(40, 30), 0);
  assert.equal(p.note(40, 31), 0);
});

ok('blood is shown only under four fifths of what there is to lose', () => {
  assert.equal(bloodShows(BLOOD.full), false);
  // (four fifths is 4500 ml: where the colour begins to go)
  assert.equal(bloodShows(BLOOD.grey[0]), false);
  assert.equal(bloodShows(BLOOD.grey[0] - 1), true);
  assert.equal(bloodShows(BLOOD.dead + 1), true);
  assert.equal(stat(read({}), 'blood').shown, false);
  // (a wound above that has its badge, and a bag running in above that has nothing to say: the symbol is not shown)
  assert.equal(stat(read({ bleed: 3.6, blood: 4990 }), 'blood').shown, false);
  assert.equal(read({ bleed: 3.6, blood: 4990 }).badges.some((b) => b.id === 'bleed'), true);
  assert.equal(stat(read({ drip: true }), 'blood').shown, false);
  assert.equal(stat(read({ blood: 4200 }), 'blood').shown, true);
  assert.equal(stat(read({ drip: true, blood: 4200 }), 'blood').shown, true);
  for (const s of ['health', 'food', 'water'] as Stat[]) assert.equal(stat(read({}), s).shown, true);
});

ok('somebody well has three white symbols, no arrows and no badge', () => {
  const r = read({});
  assert.deepEqual(r.stats.map((s) => s.stat), ['blood', 'health', 'food', 'water']);
  assert.deepEqual(r.stats.filter((s) => s.shown).map((s) => [s.stat, s.step, s.arrows]), [['health', 'fine', 0], ['food', 'fine', 0], ['water', 'fine', 0]]);
  assert.equal(r.badges.length, 0);
  assert.equal(stat(r, 'health').figure, '100');
  assert.equal(stat(r, 'blood').figure, '5000');
});

ok('a wound: a badge with how bad it is and whether it will kill, and the blood beside it', () => {
  assert.deepEqual([1.2, 3.6, 4.8, 6, 7.2, 10.8, 12, 18].map(bleedLevel), [1, 1, 1, 2, 2, 2, 3, 3]);
  // one in a limb, with all the blood there is: it will close before it kills (a warning, and no blink)
  let r = read({ bleed: BLOOD.wound.arms, blood: 4900 }, { blood: -BLOOD.wound.arms });
  let b = r.badges.find((x) => x.id === 'bleed')!;
  assert.deepEqual([b.tone, b.blink, b.level, b.figure], ['warn', false, 1, '-3.6']);
  assert.match(b.line, /^Bleeding lightly: it will close by itself/);
  assert.equal(stat(r, 'blood').arrows, -1);
  assert.equal(stat(r, 'blood').line, 'Blood: losing it. Bandage now.');
  // two in the body: it will kill, in a few minutes
  r = read({ bleed: 12, blood: 4800 }, { blood: -12 });
  b = r.badges.find((x) => x.id === 'bleed')!;
  assert.deepEqual([b.tone, b.blink, b.level], ['bad', false, 3]);
  assert.match(b.line, /^Bleeding badly: about 3 min left/);
  assert.equal(stat(r, 'blood').arrows, -3);
  // and with little left, in under a minute: the badge blinks
  r = read({ bleed: 12, blood: 3100 }, { blood: -12 });
  b = r.badges.find((x) => x.id === 'bleed')!;
  assert.deepEqual([b.tone, b.blink], ['bad', true]);
  assert.match(b.line, /under a minute left/);
  assert.equal(stat(r, 'blood').step, 'crit');
  assert.equal(stat(read({ bleed: 6, blood: 4000 }, { blood: -6 }), 'blood').line, 'Blood: losing it fast. Bandage now.');
});

ok('the other badges: a leg, the gas with and without a mask, a fire that mends and one that only warms', () => {
  assert.deepEqual(read({ broken: true }).badges.map((b) => [b.id, b.tone, b.blink]), [['leg', 'warn', false]]);
  assert.deepEqual(read({ gas: 'bare' }).badges.map((b) => [b.id, b.tone, b.blink]), [['gas', 'bad', true]]);
  assert.deepEqual(read({ gas: 'masked' }).badges.map((b) => [b.id, b.tone, b.blink]), [['gas', 'good', false]]);
  assert.deepEqual(read({ fire: 'mending', health: 60 }).badges.map((b) => [b.id, b.tone]), [['fire', 'good']]);
  assert.match(read({ fire: 'warm', bleed: 6 }).badges[0].line, /stop the bleeding first/);
  assert.match(read({ fire: 'warm', water: 5, health: 50 }).badges[0].line, /eat and drink first/);
  assert.match(read({ fire: 'warm' }).badges[0].line, /nothing to mend/);
  // all of them at once stand in one order, the wound nearest the blood
  assert.deepEqual(read({ broken: true, gas: 'bare', fire: 'warm', bleed: 6 }).badges.map((b) => b.id), ['fire', 'gas', 'leg', 'bleed']);
});

ok('in words: what each means, and why health is not mending when it is not', () => {
  assert.equal(stat(read({}), 'health').line, 'Health: fine.');
  assert.equal(stat(read({ health: 60 }, { health: 0.12 }), 'health').line, 'Health: hurt, not badly. Mending.');
  assert.equal(stat(read({ health: 60, energy: 50 }), 'health').line, 'Health: hurt, not badly. It will not mend until you have eaten and drunk.');
  assert.equal(stat(read({ health: 40, bleed: 6 }), 'health').line, 'Health: hurt. It will not mend while a wound is open.');
  assert.equal(stat(read({ health: 40, blood: 3400 }), 'health').line, 'Health: hurt. It will not mend on so little blood.');
  assert.equal(stat(read({ health: 20 }, { health: -6 }), 'health').line, 'Health: badly hurt, and slower on your feet. Falling fast.');
  assert.equal(stat(read({ blood: 4300 }), 'blood').line, 'Blood: low. The colour is going out of things. It is coming back by itself.');
  assert.equal(stat(read({ blood: 4300, energy: 15 }), 'blood').line, 'Blood: low. The colour is going out of things. Eat and drink to bring it back.');
  assert.equal(stat(read({ blood: 3300 }), 'blood').line, 'Blood: very low. Health will not mend. A blood bag or saline puts it back.');
  assert.equal(stat(read({ blood: 2800, drip: true }), 'blood').line, 'Blood: too little to run on. A bag is running in.');
  assert.match(stat(read({ energy: 20 }), 'food').line, /^Food: hungry\./);
  assert.match(stat(read({ energy: 5 }), 'food').line, /^Food: starving\./);
  assert.match(stat(read({ water: 20 }), 'water').line, /^Water: thirsty\./);
  assert.match(stat(read({ water: 0 }), 'water').line, /^Water: none\. You are losing health\./);
});

console.log(`\n${n} checks passed`);
