// The bodies of the infected, searched as a player's is and gone after five minutes; bodies an admin clears away; and
// an admin's far sight of what lies about (the owner, 2026-10-23). server/bodies.ts, server/esp.ts, and the lines of
// the server that put an infected's things on the ground. The admin orders on a real server: test/admin.test.ts.
//   npx tsx test/bodies.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodiesWithin, bodyInfo, fellWay, zedBody, zedUid } from '../server/bodies';
import { ESP, espAnswer, espRows } from '../server/esp';
import type { Box } from '../server/index';
import { ESP_AT } from '../src/net/protocol';
import type { WorldLoot } from '../src/sim/economy';
import { INFECTED, INFECTED_GRID, I_DEAD, I_IDLE, type Body } from '../src/sim/infected';
import { ITEMS, makeItem } from '../src/sim/items';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

const zed = (i: number, x: number, z: number, dead = true): Body => ({ i, s: [x, 4, z, 0.5, dead ? I_DEAD : I_IDLE, 0], hp: dead ? 0 : INFECTED.hp, own: null, h: [x, z], home: 0, diedAt: dead ? 1000 : 0, heard: 0, struck: 0 });
/** a roll of the dice that comes up as given, in turn */
const dice = (...v: number[]) => () => v.shift() ?? 0;
const corpse = (cid: string, x: number, z: number, more: Partial<Box> = {}): Box => ({ cid, kind: 'corpse', w: 8, h: 17, items: [{ ...makeItem('bandage', 1), x: 0, y: 0, rot: false }], x, y: 0, z, rot: 0, emptiedAt: -1, name: 'Gus', ...more });

ok('what one of the infected had on it is in its body, searched there, for as long as its body lies', () => {
  const b = zed(7, 120, -40);
  // (a roll under INFECTED.carries: it had something; the next, the first of its pockets: rounds, three to eight)
  const box = zedBody(b, 1, 5000, dice(0.1, 0, 0.99))!;
  assert.ok(box);
  assert.equal(box.cid, zedUid(7));
  assert.equal(box.kind, 'corpse');
  assert.equal(box.zed, 7);
  assert.deepEqual([box.w, box.h], INFECTED_GRID);
  assert.deepEqual([box.x, box.y, box.z, box.rot, box.v], [120, 4, -40, 0.5, 1]);
  assert.equal(box.items.length, 1);
  assert.equal(box.items[0].id, 'ammo_9mm');
  assert.equal(box.items[0].qty, 8);
  // five minutes, as the body itself lies
  assert.equal(INFECTED.linger, 300);
  assert.equal(box.expires, 5000 + 300);
  // and the games are told it is one of the infected's, which they draw
  assert.deepEqual(bodyInfo(box), { uid: zedUid(7), x: 120, y: 4, z: -40, rot: 0.5, name: 'Infected', v: 1, zed: 7 });
  // nothing on it: nothing to search
  assert.equal(zedBody(b, 0, 5000, dice(0.99)), null);
});

ok('every thing any of them can have on it fits the grid of its body', () => {
  for (let k = 0; k < 400; k++) {
    let s = k * 7919;
    const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
    const box = zedBody(zed(k, 0, 0), 0, 0, rnd);
    if (box) assert.equal(box.items.length, 1, `${k}`);
  }
  for (const id of ['ammo_9mm', 'ammo_762', 'bandage', 'beans', 'sardines', 'apple', 'cigarettes', 'watch', 'compass', 'knife']) {
    const d = ITEMS[id];
    assert.ok(d && Math.min(d.w, d.h) <= INFECTED_GRID[1] && Math.max(d.w, d.h) <= INFECTED_GRID[0], id);
  }
});

ok('which way one fell is worked out as every game works it out', () => {
  // a blow from in front (coming towards -z, at a body facing -z: along its facing, backwards): onto its back
  assert.equal(fellWay(0, [0, 1]), 0);
  assert.equal(fellWay(0, [0, -1]), 1);
  assert.equal(fellWay(0, [1, 0]), 2);
  assert.equal(fellWay(Math.PI / 2, [-1, 0]), 1);
});

ok('the bodies within so many metres: players\' and the infected\'s, each once, nearest first; none still riding; none alive', () => {
  const boxes = [corpse('corpse_1_a', 10, 0), corpse('corpse_2_b', 80, 0), corpse('corpse_3_c', 5, 0, { ride: { i: 1, seat: 0 } }), corpse(zedUid(4), 20, 0, { zed: 4, name: 'Infected' }), { ...corpse('crate_1', 1, 1), kind: 'crate' as const }];
  const horde = [zed(4, 20, 0), zed(5, 3, 0), zed(6, 30, 0, false), zed(9, 300, 0)];
  const near = bodiesWithin(boxes, horde, 0, 0, 60);
  assert.deepEqual(near, [{ zed: 5, x: 3, z: 0 }, { box: 'corpse_1_a', x: 10, z: 0 }, { box: zedUid(4), zed: 4, x: 20, z: 0 }]);
  assert.equal(bodiesWithin(boxes, horde, 0, 0, 400).length, 5);
  assert.deepEqual(bodiesWithin(boxes, horde, 1000, 1000, 60), []);
});

ok('the far sight sees things lying, put away, and in bodies, crates and stashes, within its reach, nearest first', () => {
  const lying = (uid: string, id: string, qty: number, x: number, z: number, point = -1): WorldLoot => ({ uid, item: { ...makeItem(id, qty), uid }, x, y: 1, z, rot: 0, point, spawnedAt: 0 });
  const loot = [lying('a', 'ammo_9mm', 20, 30, 0), lying('b', 'bandage', 1, 5, 0, 12), lying('c', 'knife', 1, 400, 0)];
  const tin = { ...makeItem('beans', 1), x: 0, y: 0, rot: false }, gun = { ...makeItem('mosin', 1), x: 1, y: 0, rot: false };
  const boxes: Box[] = [
    corpse('corpse_1', 10, 0, { items: [tin, gun] }),
    { ...corpse('crate_1', 0, 50), kind: 'crate', items: [] },
    { ...corpse('stash_1', 0, 60), kind: 'stash', buried: true, items: [tin] },
    { ...corpse('furn_1', 0, 2), kind: 'furniture', items: [tin] },
  ];
  const rows = espRows(loot, boxes, 0, 0, (p) => p === 12);
  assert.deepEqual(rows, [
    [0, 0, 2, 'beans', 1, ESP_AT.furniture],
    [5, 1, 0, 'bandage', 1, ESP_AT.furniture],
    [10, 0, 0, 'mosin', 2, ESP_AT.body],
    [30, 1, 0, 'ammo_9mm', 20, ESP_AT.ground],
    [0, 0, 60, 'beans', 1, ESP_AT.buried],
  ]);
  // no more than so many, the nearest
  const many = Array.from({ length: ESP.most + 40 }, (_, k) => lying(`m${k}`, 'apple', 1, k * 0.5, 0));
  const most = espRows(many, [], 0, 0, () => false);
  assert.equal(most.length, ESP.most);
  assert.equal(most[0][0], 0);
});

ok('the far sight is answered to an admin alone, and no oftener than it should be', () => {
  const rows = () => [[1, 2, 3, 'apple', 1, 0] as [number, number, number, string, number, number]];
  const player = {}, mod = {}, admin = {};
  assert.equal(espAnswer(player, null, 1000, rows), null);
  assert.equal(espAnswer(mod, 'mod', 1000, rows), null);
  assert.deepEqual(espAnswer(admin, 'admin', 1000, rows), rows());
  assert.equal(espAnswer(admin, 'admin', 1000 + ESP.every - 1, rows), null);
  assert.deepEqual(espAnswer(admin, 'admin', 1000 + ESP.every, rows), rows());
});

ok('the server no longer puts an infected\'s things on the ground; their bodies go with them, and are not kept', () => {
  const read = (f: string) => readFileSync(new URL(`../server/${f}`, import.meta.url), 'utf8');
  for (const f of ['handle.ts', 'gate.ts']) {
    assert.ok(!/infectedDrop/.test(read(f)), `${f} still rolls an infected's pockets onto the ground`);
    assert.ok(/infectedBody\(b, dir\)/.test(read(f)), `${f} does not put an infected's things in its body`);
  }
  const index = read('index.ts');
  assert.ok(/for \(const i of turn\.gone\) \{[\s\S]{0,200}zedUid\(i\)/.test(index), 'a body cleared away by the infected\'s clock leaves its box behind');
  assert.ok(/b\.ride \|\| b\.zed !== undefined/.test(index), 'the world save keeps the infected\'s bodies');
  assert.ok(/b\.zed === undefined/.test(read('keep.ts')), 'the bodies kept through a restart take the infected\'s along');
  assert.ok(/case 'esp':[\s\S]{0,300}espAnswer\(c, roleOf\(c\)/.test(read('handle.ts')), 'the far sight is not asked who is asking');
});

console.log(`${n} checks passed`);
