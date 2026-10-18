// The one item card (src/ui/inv-card.ts, idea 15): every key lands on the row whose deed it does, a key with no row
// of its own is given one (before Drop), and a key that does nothing is left out.
//   npx tsx test/inv-card.test.ts

import assert from 'node:assert/strict';
import { KEY, rows, type Action, type Deed } from '../src/ui/inv-card';

const run = () => {};
const acts: Action[] = [
  { label: 'Eat it now', icon: 'hand', id: 'use', primary: true, run },
  { label: 'Take in hands', icon: 'hand', id: 'hands', run },
  { label: 'Drop', icon: 'drop', id: 'drop', danger: true, run },
];

// each key on its row; the deed's own row kept, not doubled
{
  const keys: [string, Deed][] = [
    [KEY.use, { label: 'Eat it', id: 'use', icon: 'hand', run }],
    [KEY.across, { why: 'Nothing is open to move it into' }],
    [KEY.wield, { label: 'Take in hands', id: 'hands', icon: 'hand', run }],
    [KEY.quick, { label: 'Eat it now', id: 'use', icon: 'hand', run }],
    [KEY.drop, { label: 'Drop', id: 'drop', icon: 'drop', run }],
  ];
  const list = rows(acts, keys);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((r) => r.keys), [[KEY.use, KEY.quick], [KEY.wield], [KEY.drop]]);
  assert.equal(list[0].label, 'Eat it now', 'the row keeps the menu\'s words');
  assert.ok(!list.some((r) => r.keys.includes(KEY.across)), 'a key that does nothing is on no row');
}

// a key whose deed has no row gets one, before Drop
{
  const list = rows(acts, [[KEY.wield, { label: 'Take it out', id: 'out', icon: 'out', run }]]);
  assert.deepEqual(list.map((r) => r.label), ['Eat it now', 'Take in hands', 'Take it out', 'Drop']);
  assert.deepEqual(list[2].keys, [KEY.wield]);
}

console.log('inv-card: ok');
