// The Halloween event: a tag cashed in within its window pays EVENT.pay whatever its wallet holds, one outside it pays as it always has, and the crowd goes up at once and
// comes down as the extra die.
import assert from 'node:assert/strict';
import { EVENT, eventOn } from '../api/_lib/event';
import { holderBonus, price, rateOf, termsOf } from '../api/_lib/payouts';
import { Director } from '../src/sim/infected';

const SOL = 1_000_000_000n, floor = SOL / 100n, tagMax = (SOL * 25n) / 1000n, holderPerM = SOL / 1000n;
const cfg = { share: 0.02, floor, ceiling: 5n * SOL, keep: SOL / 100n, rulesFrom: 0, rules2From: 0, rules5From: 0, floorBefore: SOL / 50n, holderPerM, tagMax } as unknown as Parameters<typeof termsOf>[0];
const iso = (t: number) => new Date(t).toISOString();

assert.equal(EVENT.to - EVENT.from, 4 * 3600_000, 'four hours');
assert.ok(eventOn(EVENT.from) && !eventOn(EVENT.to) && !eventOn(EVENT.from - 1));
const inside = termsOf(cfg, iso(EVENT.from + 1000)), before = termsOf(cfg, iso(EVENT.from - 1000)), after = termsOf(cfg, iso(EVENT.to + 1000));
assert.equal(price(3n * SOL, inside), tagMax, 'in the window a tag pays 0.025');
assert.equal(price(3n * SOL, before), floor, 'before it, 0.01');
assert.equal(price(3n * SOL, after), floor, 'after it, 0.01');
const tag = (at: number) => ({ at: iso(at), held: String(5_000_000n * 10n ** 6n) }) as unknown as Parameters<typeof holderBonus>[1];
assert.equal(holderBonus(cfg, tag(EVENT.from + 1000), true, tagMax, 5_000_000n * 10n ** 6n), 0n, 'nothing on top of it for holding');
assert.ok(holderBonus(cfg, tag(EVENT.to + 1000), true, floor, 5_000_000n * 10n ** 6n) > 0n, 'holding pays again after it');
assert.equal(rateOf(inside, 0n).perTag, tagMax, 'the wallet with nothing is told 0.025');
assert.equal(rateOf(inside, 50_000_000n * 10n ** 6n).perTag, tagMax);

let n = 0;
const homes = [{ x: 0, z: 0, n: 3 }, { x: 500, z: 0, n: 4 }] as unknown as ConstructorParameters<typeof Director>[0];
const horde = new Director(homes, (h) => ({ x: (h as unknown as { x: number }).x + (n += 3), y: 0, z: 0 }));
const living = () => [...horde.bodies.values()].filter((b) => !b.diedAt).length;
let now = 1000;
horde.tick(now, []);
assert.equal(living(), 7, 'as it stands now');
horde.crowd(EVENT.crowd);
horde.tick((now += 1000), []);
assert.equal(living(), 14, 'twice that at once');
for (const b of [...horde.bodies.values()].slice(0, 4)) horde.hurt(b.i, 1e6, now);
horde.tick((now += 1e6), []);
assert.equal(living(), 14, 'the dead are put back during it');
horde.crowd(1);
for (const b of [...horde.bodies.values()].slice(0, 9)) horde.hurt(b.i, 1e6, now);
horde.tick((now += 1e6), []);
assert.equal(living(), 7, 'after it, back to the count as the extra die');
console.log('halloween event ok');
