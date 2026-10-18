// The inventory's search box (searchMatch in src/ui/inv-search.ts): what each word typed finds.
//   npx tsx test/inv-search.test.ts

import assert from 'node:assert/strict';
import { searchMatch, searchTerms } from '../src/ui/inv-search';
import { ITEMS, makeItem } from '../src/sim/items';

const finds = (q: string, id: string) => searchMatch(makeItem(id), searchTerms(q));
const nineMil = Object.keys(ITEMS).filter((id) => ITEMS[id].weapon?.ammo === 'ammo_9mm');

assert.ok(finds('9mm', 'ammo_9mm'), '9mm did not find 9x19mm Rounds');
assert.ok(finds('9x19', 'ammo_9mm'), '9x19 did not find 9x19mm Rounds');
assert.ok(nineMil.length && nineMil.every((id) => finds('9mm', id)), 'a 9 mm gun was not found by 9mm');
assert.ok(finds('9mm', ITEMS[nineMil[0]].weapon!.mag!), 'its magazine was not found by 9mm');
assert.ok(!finds('9mm', 'bandage'), 'a bandage was found by 9mm');
console.log('  ok  "9mm" finds the rounds, the guns that fire them and their magazines, and nothing else');

assert.ok(finds('medical', 'bandage') && finds('MED', 'bandage'), 'a bandage is not medical');
assert.ok(!finds('medical', 'ammo_9mm'), 'rounds are medical');
console.log('  ok  a kind finds what is of it, whatever its case');

assert.ok(finds('', 'bandage') && finds('  ', 'ammo_9mm'), 'an empty box hides things');
assert.ok(finds('9x19 rounds', 'ammo_9mm') && !finds('9x19 bandage', 'ammo_9mm'), 'every word typed must be found');
console.log('  ok  nothing typed finds everything; every word typed must be found');
