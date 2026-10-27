// Where everybody is, told only within sight (server/sight.ts): near, far, the edge kept, the party, an admin.
import assert from 'node:assert/strict';
import { SIGHT, inSight } from '../server/sight';

const me = { id: 1, x: 0, z: 0 };
const at = (id: number, x: number) => ({ id, x, z: 0 });
const rows = [at(1, 0), at(2, 200), at(3, SIGHT.near + 50), at(4, 5000)];
const ids = (r: { id: number }[]) => r.map((x) => x.id);
const none = new Set<number>();

const told = new Set<number>();
let r = inSight(me, rows, told, none);
assert.deepEqual(ids(r.see), [1, 2], 'themselves and whoever is near, nobody further');
assert.deepEqual(r.out, []);

// one told of, now on the edge between near and keep: still told of; past keep: out
told.add(3);
r = inSight(me, rows, told, none);
assert.deepEqual(ids(r.see), [1, 2, 3], 'one already told of is kept to the edge');
r = inSight(me, [at(1, 0), at(2, 200), at(3, SIGHT.keep + 10)], told, none);
assert.deepEqual(ids(r.see), [1, 2]);
assert.deepEqual(r.out, [3], 'one gone past the edge is said to be out');
r = inSight(me, [at(1, 0), at(2, 200)], told, none);
assert.deepEqual(r.out, [], 'and said so once');

// the party, however far; an admin, everybody
assert.deepEqual(ids(inSight(me, rows, new Set(), new Set([4])).see), [1, 2, 4], 'a party member however far');
assert.deepEqual(ids(inSight(me, rows, new Set(), none, true).see), [1, 2, 3, 4], 'an admin is told of everybody');

console.log('sight ok');
