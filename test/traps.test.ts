// What the small wins of 2026-10-31 are held to. Traps: a foot does not step over one at a sprint, and each armed thing is
// an item with a rule. The smoke grenade and the flare hurt nobody, and go by a grenade's rules.
import assert from 'node:assert/strict';
import { WEAPON_RULES } from '../src/sim/combat';
import { LAUNCHED, THROWN, inHandDamage } from '../src/sim/grenades';
import { ITEMS } from '../src/sim/items';
import { TRAPS, isTrap, steppedOn, trapsBack } from '../src/sim/traps';

let n = 0;
const ok = (name: string, f: () => void) => {
  f();
  n++;
  console.log(`  ok  ${name}`);
};

ok('every trap is an item that can be set', () => {
  for (const k of Object.keys(TRAPS)) {
    assert.ok(isTrap(k));
    assert.ok(ITEMS[k]?.use, `${k} has no use`);
  }
  assert.ok(!isTrap('grenade'));
});

ok('a foot sets one off from either side, and a sprint does not step over it', () => {
  assert.ok(steppedOn(0, 0, 0, 0, 0.3, 0, 0.6));
  assert.ok(!steppedOn(0, 0, 0, 0, 1, 0, 0.6));
  // (a metre and more between two looks, the trap between them)
  assert.ok(steppedOn(-0.6, 0, 0.6, 0, 0, 0.2, 0.6));
  assert.ok(!steppedOn(-0.6, 0, 0.6, 0, 0, 0.9, 0.6));
  assert.ok(!steppedOn(1, 0, 2, 0, 0, 0, 0.6));
});

ok('a smoke grenade goes by a grenade\'s rules and hurts nobody, in the hand or out of it', () => {
  assert.ok(THROWN.smoke_grenade, 'not thrown as a grenade is');
  assert.equal(WEAPON_RULES.smoke_grenade.damage, 0);
  assert.equal(inHandDamage('smoke_grenade'), 0);
  assert.equal(WEAPON_RULES.smoke_grenade.car, 0);
});

ok('a flare is fired as a launcher\'s round is, and hurts nobody', () => {
  assert.equal(ITEMS.flare_gun.weapon?.launches, 'ammo_flare');
  assert.ok(LAUNCHED.ammo_flare);
  assert.equal(WEAPON_RULES.ammo_flare.damage, 0);
});

ok('a land mine is the end of a car', () => {
  assert.ok(WEAPON_RULES.land_mine.damage > 0);
  assert.equal(WEAPON_RULES.land_mine.car, 1);
});

ok('over a restart a trap comes back with the end it had, and one whose time is up does not', () => {
  const t = { k: 'land_mine', x: 1, y: 2, z: 3, yaw: 0, key: 'a', name: 'Ann', ends: 2000 };
  assert.deepEqual(trapsBack([t, { ...t, ends: 500 }, { ...t, k: 'grenade' }, { ...t, x: NaN }, null], 1000), [t]);
  assert.deepEqual(trapsBack(undefined, 1000), []);
});

console.log(`${n} checks passed`);
