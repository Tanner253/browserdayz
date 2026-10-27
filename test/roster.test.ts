// Everybody who has played, for an admin's /find and a ban of somebody gone (server/roster.ts): found by a name they
// went by or their device, the exact name first, kept through a restart, names brought up to date.
import assert from 'node:assert/strict';
import { roster } from '../server/roster';

roster.mark({ key: 'k-anna', ip: '203.0.113.5', fp: 'aaaa1111', name: 'Anna' });
roster.mark({ key: 'k-annabel', ip: '203.0.113.6', fp: 'bbbb2222', name: 'Annabel' });
roster.mark({ key: 'k-bob', ip: '203.0.113.7', fp: 'cccc3333', name: 'Bob' });

assert.deepEqual(roster.find('anna').map((p) => p.names.at(-1)), ['Anna', 'Annabel'], 'the exact name first, then the latest');
assert.deepEqual(roster.find('', 'cccc').map((p) => p.names.at(-1)), ['Bob'], 'by device');
assert.equal(roster.find('a').length, 0, 'one letter finds nobody');

// a new name for the same game: one entry, both names
roster.mark({ key: 'k-bob', ip: '203.0.113.7', fp: 'cccc3333', name: 'Robert' });
const bob = roster.find('robert')[0];
assert.deepEqual(bob.names, ['Bob', 'Robert']);
assert.equal(roster.find('bob')[0].key, bob.key, 'found by an old name too');

// kept and read back
const kept = JSON.parse(JSON.stringify(roster.keep()));
roster.restore(kept);
assert.equal(roster.keep().length, 3, 'read back over itself: nobody twice');

// whoever cashed a tag before the roster began is put on it (pinned.ts), and found; one on it already is left as is
roster.seed('k-quati', 'Quati', Date.now() - 3 * 86400_000);
roster.seed('k-bob', 'Someone else', Date.now());
assert.equal(roster.find('quati')[0]?.key, 'k-quati', 'a payouts name is found');
assert.deepEqual(roster.find('robert')[0].names, ['Bob', 'Robert'], 'a seed does not overwrite');

console.log('roster ok');
