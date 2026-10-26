// npx tsx test/melee-rules.test.ts: every thing swung as a weapon is believed by the server when it lands (2026-10-25,
// the owner: "the new shovel and hatchet and EVERYTHING should be a weapon that is a melee weapon in the game"). A melee
// item with no rule had every blow it landed thrown away by server/handle.ts.
import assert from 'node:assert/strict';
import { ITEMS } from '../src/sim/items';
import { WEAPON_RULES, hitDamage } from '../src/sim/combat';

let n = 0;
for (const d of Object.values(ITEMS)) {
  if (!d.melee) continue;
  const r = WEAPON_RULES[d.id];
  assert.ok(r?.melee, `${d.id} swings in the hands but the server has no melee rule for it`);
  assert.equal(r.damage, d.melee.damage, `${d.id}: the server's damage is not the item's`);
  assert.ok(r.range > d.melee.range, `${d.id}: the server reaches less far than the swing`);
  assert.ok(hitDamage(d.id, 'torso', 1.5) > 0, `${d.id} does no damage on the server`);
  n++;
}
console.log(`melee rules: ${n} things to hit with, each believed by the server`);
