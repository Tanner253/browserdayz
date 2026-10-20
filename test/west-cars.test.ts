// The west's car places (server/west-cars.ts, JEEP.refill): the owner, 2026-10-20, of the live map at two hours up with
// every car driven east: "all the cars are not in the west lol". Plain rules, no server.
import assert from 'node:assert/strict';
import { idleMs, westDue } from '../server/west-cars';
import { JEEP } from '../src/sim/vehicles';

// two places of the east's, then eight of the west's along the coast
const parks = [{ x: 500, z: 0 }, { x: 800, z: 200 }, ...Array.from({ length: 8 }, (_, i) => ({ x: -3000, z: -800 + i * 200 }))];
const from = 2, west = parks.length - from;
const nobody = () => false, none = () => false;
const east = (home: number) => ({ home, s: [400 + home * 10, 0, 300] });

// three of each west place's driven east and left there, as on the live map: the west still stands its own, after its time
const left = Array.from({ length: west * 3 }, (_, i) => east(from + (i % west)));
const empty = new Map<number, number>();
assert.deepEqual(westDue(left, parks, from, 0, empty, none, nobody), [], 'a place stood a car before it had stood empty its time');
const due = westDue(left, parks, from, JEEP.refill.after * 1000, empty, none, nobody);
assert.equal(due.length, west, `the west stood ${due.length} of its ${west} places' cars with three of each driven east`);
console.log('  ok  three cars of every west place driven east, and each place stands its own again after its time');

// one still at its place, or two of its own near it: nothing more there
const atHome = [{ home: from, s: [parks[from].x + 2, 0, parks[from].z] }];
const twoNear = [from + 1, from + 1].map((home) => ({ home, s: [parks[from + 1].x + 200, 0, parks[from + 1].z] }));
const e2 = new Map<number, number>();
westDue([...atHome, ...twoNear], parks, from, 0, e2, none, nobody);
const d2 = westDue([...atHome, ...twoNear], parks, from, JEEP.refill.after * 1000, e2, none, nobody);
assert.ok(!d2.includes(from) && !d2.includes(from + 1), 'a place stood another with its own still there, or two of its own near');
assert.equal(d2.length, west - 2);
// somebody on the spot, or its own due back by the respawn: not then
const e3 = new Map<number, number>();
westDue([], parks, from, 0, e3, (h) => h === from, (p) => p === parks[from + 1]);
const d3 = westDue([], parks, from, JEEP.refill.after * 1000, e3, (h) => h === from, (p) => p === parks[from + 1]);
assert.ok(!d3.includes(from) && !d3.includes(from + 1));
console.log('  ok  none while its own stands there or two are near, nor with somebody on the spot or its own due back');

// the map's ceiling: never more than `cap` to each west place in all
const full = Array.from({ length: west * JEEP.refill.cap }, (_, i) => east(from + (i % west)));
const e4 = new Map<number, number>();
westDue(full, parks, from, 0, e4, none, nobody);
assert.deepEqual(westDue(full, parks, from, JEEP.refill.after * 1000, e4, none, nobody), []);
console.log(`  ok  none past ${JEEP.refill.cap} to each west place on the whole map`);

// left alone: one of the west's away from its place goes after JEEP.refill.idle; at its place, or the east's, as before
const H2 = 7200_000;
assert.equal(idleMs(east(from), parks, from, H2), JEEP.refill.idle * 1000);
assert.equal(idleMs({ home: from, s: [parks[from].x + 100, 0, parks[from].z] }, parks, from, H2), H2);
assert.equal(idleMs(east(0), parks, from, H2), H2);
assert.equal(idleMs(east(from), parks, from, 60_000), 60_000, 'a shorter idle for the server (CAR_IDLE_S) was lengthened');
console.log('  ok  a west car left away from its place goes sooner; others as before');
console.log('\n4 checks passed');
