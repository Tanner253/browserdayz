// /stashes: where every stash kept lies, for the owner alone (2026-10-23: the map is not to be changed about them, and
// since stash-sight.ts nobody is told of a buried one far off). server/stash-list.ts, and the order in server/admin.ts.
//   npx tsx test/stash-list.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stashLines } from '../server/stash-list';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

ok('every stash kept, buried or lying, fifteen to a line, each line JSON after STASHES', () => {
  const boxes = [
    ...Array.from({ length: 20 }, (_, k) => ({ kind: 'stash', buried: true, x: k + 0.04, y: 2.26, z: -k })),
    { kind: 'corpse', x: 1, y: 1, z: 1 },
    { kind: 'stash', buried: false, x: 5, y: 5, z: 5 },
  ];
  const loot = [{ keptAt: 1, x: 7, y: 8, z: 9 }, { x: 70, y: 80, z: 90 }];
  const { total, buried, lines } = stashLines(boxes, loot);
  assert.equal(total, 22);
  assert.equal(buried, 20);
  assert.equal(lines.length, 2);
  const all = lines.flatMap((l) => (assert.match(l, /^STASHES \[/), JSON.parse(l.slice(8)) as number[][]));
  assert.equal(all.length, 22);
  assert.deepEqual(all[0], [0, 2.3, 0, 1]);
  assert.deepEqual(all.at(-1), [7, 8, 9, 0]);
});

ok('only the top of the line may ask; the answer is to them alone; the log says how many and never where', () => {
  const src = readFileSync('server/admin.ts', 'utf8'), at = src.indexOf("case 'stashes'"), body = src.slice(at, src.indexOf('case ', at + 10));
  assert.ok(at > 0, 'the order is there');
  assert.match(body, /if \(!isTop\(c\)\) return void sys\(c, 'Only the owner can do that\.'\)/);
  assert.doesNotMatch(body, /broadcast|send\(\s*o\b|clients/, 'nobody else is told');
  const logs = body.match(/log\(`[^`]*`\)/g) ?? [];
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /lines|\.x|\.z|STASHES/, 'the log says no place');
  assert.match(body, /return void sys\(c, `\$\{total\} stashes kept/);
});

ok('the top of the line is an admin by the password (gate.ts), not any admin or mod', () => {
  const gate = readFileSync('server/gate.ts', 'utf8');
  assert.match(gate, /export const isTop = \(c: Client\) => LOCAL_ADMIN \|\| topRole\(keyHash\(c\.key\)\)/);
  assert.match(gate, /return r\?\.role === 'admin' && r\.by === 'password' && \(r\.up === k \|\| \(!r\.up && r\.at < RANKS_FROM\)\)/);
});

console.log(`${n} checks passed`);
