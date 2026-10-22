// A player's name and payout wallet fixed at their first cashed tag, and an admin's /unlock (the owner, 2026-10-22: "we
// should prevent a user from changing their wallet and username once they cash in their first tag. admin can allow user
// to change from admin panel"). server/pinned.ts, and the lines of the server that read it.
//   npx tsx test/pinned.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pinned } from '../server/pinned';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};
const W1 = '9BLCDZ3DRkVmyifihE5qupoBEmu16FVtJUFL3jDyTvYN', W2 = '54qsnnByBpuLcRgCuzpPYd14XebQ2augCzwxrhyRcvh9';

ok('the first cashed tag fixes the name and the wallet; later ones change neither', () => {
  const a = pinned.cash('key-a', 'Alice', W1);
  assert.equal(a.fresh, true);
  assert.deepEqual([a.pin.name, a.pin.wallet], ['Alice', W1]);
  const b = pinned.cash('key-a', 'Mallory', W2);
  assert.equal(b.fresh, false);
  assert.deepEqual([b.pin.name, b.pin.wallet], ['Alice', W1]);
  assert.equal(pinned.of('key-a')?.name, 'Alice');
});

ok('cashed with no wallet: the name is fixed, and the first wallet given after is fixed at its tag', () => {
  assert.equal(pinned.cash('key-b', 'Bob', '').pin.wallet, '');
  const then = pinned.cash('key-b', 'Bobby', W2);
  assert.equal(then.fresh, true);
  assert.deepEqual([then.pin.name, then.pin.wallet], ['Bob', W2]);
  assert.equal(pinned.cash('key-b', 'Bob', W1).pin.wallet, W2);
});

ok('an admin frees one who is on (by key) or one who is not (by the name fixed); fixed again at the next tag', () => {
  assert.equal(pinned.free('key-a'), true);
  assert.equal(pinned.of('key-a'), undefined);
  assert.equal(pinned.free('key-a'), false);
  assert.deepEqual(pinned.cash('key-a', 'Alicia', W2).pin, { ...pinned.of('key-a')!, name: 'Alicia', wallet: W2 });
  assert.equal(pinned.freeName('bob'), 'Bob');
  assert.equal(pinned.of('key-b'), undefined);
  assert.equal(pinned.freeName('nobody'), null);
});

ok('kept with the world and taken back after a restart; one fixed here already stands', () => {
  const kept = pinned.keep();
  pinned.free('key-a');
  pinned.cash('key-c', 'Carol', W1);
  pinned.restore([...kept, ...pinned.keep().map(([k]) => [k, { name: 'Other', wallet: W2, at: 1 }] as [string, { name: string; wallet: string; at: number }])]);
  assert.equal(pinned.of('key-a')?.name, 'Alicia');
  assert.equal(pinned.of('key-c')?.name, 'Carol');
});

ok('the server reads it: the name at joining, the wallet at a cashed tag, the list kept, /unlock for admins', () => {
  const players = readFileSync('server/players.ts', 'utf8'), handle = readFileSync('server/handle.ts', 'utf8');
  const keep = readFileSync('server/keep.ts', 'utf8'), admin = readFileSync('server/admin.ts', 'utf8');
  assert.match(players, /name: pinned\.of\(key\)\?\.name \?\? cleanName\(m\.name\)/);
  assert.match(handle, /pinned\.cash\(c\.key, c\.name, given\)[\s\S]{0,80}recordCashIn\(c, from\.owner, pin\.wallet\)/);
  assert.match(keep, /pinned: pinned\.keep\(\)/);
  assert.equal((keep.match(/pinned\.restore\(snap\.pinned\)/g) ?? []).length, 2);
  assert.match(admin, /case 'unlock': \{[\s\S]{0,200}if \(!admin\) return need\(\);/);
});

console.log(`${n} checks passed`);
