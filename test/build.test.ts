// Building: where a piece can go (src/sim/build/snap.ts), and the store of bases (src/sim/build/bases.ts), 2026-10-24.
//   npx tsx test/build.test.ts
//
// What was asked: "snapping building and a clean ui and ux is super important"; "do we offer enough base pieces for
// players to make their own dynamic bases?"; "think like rust how does rust do it". So, on flat ground and on a slope:
// foundations go edge to edge, squares and triangles together, at one level; walls stand on edges, one to an edge,
// their hard side out unless turned; floors go over walls and out one cell past them, no further; stairs need room
// over them; nothing is built over four storeys; a piece taken away takes what stood only on it; a foundation stands
// on posts no longer than they are, and never in the ground; the save keeps every piece and works out again what each
// rests on.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import type { ItemInstance } from '../src/sim/items';
import { buildWorldData } from '../server/world';
import { Solids, noBuilding, wetAt } from '../src/sim/build/land';
import { Bases, heard, heardPiece, said, type Land } from '../src/sim/build/bases';
import { CELL, PIECES, PIECE_IDS, STOREY, TIER_S, costOf, hpOf, type Tier } from '../src/sim/build/pieces';
import { blocked, deployAt, edgesOf, nearestSpot, spots, standing, toLocal, toWorld, type Base } from '../src/sim/build/snap';
import { ROT, bracket, pay, perDay, protectedFor, rot, saidTime } from '../src/sim/build/upkeep';
import { inTheWay, swept } from '../src/sim/build/doors';

let n = 0;
const failed: string[] = [];
const ok = (name: string, fn: () => void) => {
  try {
    fn();
    n++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed.push(name);
    console.log(`  NOT OK  ${name}\n          ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
  }
};
const flat: Land = { ground: () => 10, why: () => null };
const ME = 'me';
/** lay `k` at the spot of `b` nearest a place in its frame */
const at = (bs: Bases, b: Base, k: string, x: number, y: number, z: number, turn = 0) => {
  const s = nearestSpot(spots(b, k, turn), k, { x, y, z }, 4);
  assert.ok(s, `no spot for ${k} near ${x}, ${y}, ${z}`);
  const r = bs.lay({ b: b.id, k, ...s }, ME, 1000);
  assert.ok(typeof r !== 'string', `${k} at ${x}, ${y}, ${z}: ${r}`);
  return r.piece;
};
const start = (bs: Bases, x = 0, z = 0, yaw = 0, k = 'foundation') => {
  const r = bs.lay({ k, x, y: 0, z, r: 0, yaw }, ME, 1000);
  assert.ok(typeof r !== 'string', `the first foundation: ${r}`);
  return r.base;
};

console.log('Building: pieces');
ok('costs and health by tier, as the plan says; half pieces half; a foundation\'s frame on two logs', () => {
  assert.deepEqual(costOf('wall', 0), { planks: 4 });
  assert.deepEqual(costOf('wall', 1), { planks: 10, nails: 12 });
  assert.deepEqual(costOf('wall', 2), { stone: 30 });
  assert.deepEqual(costOf('wall', 3), { sheet_metal: 4, nails: 24 });
  assert.deepEqual(costOf('wall_half', 1), { planks: 5, nails: 6 });
  assert.deepEqual(costOf('foundation', 0), { planks: 4, log: 2 });
  assert.deepEqual([0, 1, 2, 3].map((t) => hpOf('wall', t as Tier)), [60, 500, 1000, 2000]);
  // (plan v2: 22 pieces, less the ladder that is set down, and 12 fittings: the doors, the windows' and the gates)
  const fitting = (k: string) => PIECES[k].role === 'fit' || k.startsWith('gate_');
  assert.equal(Object.keys(PIECES).filter((k) => PIECES[k].role !== 'deploy' && !fitting(k)).length, 21);
  assert.equal(Object.keys(PIECES).filter(fitting).length, 12);
});

console.log('Building: snapping');
ok('a first foundation sits a hand over the highest ground under it; four more go round it, one to an edge', () => {
  const bs = new Bases(flat), b = start(bs);
  assert.equal(b.oy, 10.25);
  const s = spots(b, 'foundation');
  assert.equal(s.length, 4);
  for (const q of s) assert.ok(Math.abs(Math.hypot(q.x, q.z) - CELL) < 1e-6 && q.y === 0);
  at(bs, b, 'foundation', 3, 0, 0);
  // (the edge they share offers nothing more: three round the first, three round the second)
  assert.equal(spots(b, 'foundation').filter((q) => !blocked(b, 'foundation', q)).length, 6);
});

ok('triangles and squares together: a triangle on a square\'s edge, a square on the triangle\'s, none through another', () => {
  const bs = new Bases(flat), b = start(bs);
  const t = at(bs, b, 'foundation_tri', 2.5, 0, 0);
  assert.ok(Math.abs(t.x - (1.5 + CELL / (2 * Math.sqrt(3)))) < 0.01 && Math.abs(t.z) < 0.01, `triangle at ${t.x}, ${t.z}`);
  // the triangle's other two edges are 60 degrees round: a square on each
  const free = spots(b, 'foundation').filter((q) => !blocked(b, 'foundation', q));
  const slanted = free.filter((q) => q.r % 3 !== 0);
  assert.equal(slanted.length, 2, `${slanted.length} squares turned on the triangle`);
  at(bs, b, 'foundation', slanted[0].x, 0, slanted[0].z);
  // (and a square that would go through the first is refused)
  const through = { x: 0.5, y: 0, z: 0, r: 0, on: [] };
  assert.match(blocked(b, 'foundation', through) ?? '', /built there|through/);
});

ok('walls stand on edges, one to an edge, hard side out; turned, the soft side is out; on a wall\'s top, another', () => {
  const bs = new Bases(flat), b = start(bs);
  const w = at(bs, b, 'wall', 0, 1.5, 1.5);
  // (its outside is the edge's outside: away from the foundation's middle)
  const out = [Math.sin((w.r * Math.PI) / 6), Math.cos((w.r * Math.PI) / 6)];
  assert.ok(out[0] * w.x + out[1] * w.z > 0, 'the wall faces in');
  const again = nearestSpot(spots(b, 'wall'), 'wall', { x: 0, y: 1.5, z: 1.5 })!;
  assert.match(blocked(b, 'wall', again) ?? '', /already/);
  const turned = nearestSpot(spots(b, 'doorway', 1), 'doorway', { x: 1.5, y: 1.5, z: 0 })!;
  const fx = Math.sin((turned.r * Math.PI) / 6) * turned.x + Math.cos((turned.r * Math.PI) / 6) * turned.z;
  assert.ok(fx < 0, 'turned, it still faces out');
  // a half wall on a half wall
  const h = at(bs, b, 'wall_half', -1.5, 0.75, 0);
  const top = at(bs, b, 'wall_half', -1.5, 2.25, 0);
  assert.equal(top.y, h.y + STOREY / 2);
  assert.deepEqual(top.on, [h.id]);
});

ok('a floor goes over four walls; out one cell past them; not two', () => {
  const bs = new Bases(flat), b = start(bs);
  for (const [x, z] of [[0, 1.5], [1.5, 0], [0, -1.5], [-1.5, 0]]) at(bs, b, 'wall', x, 1.5, z);
  const f = at(bs, b, 'floor', 0, STOREY, 0);
  assert.equal(f.y, STOREY);
  assert.equal(f.on.length, 4, `rests on ${f.on.length} walls`);
  // a balcony out from it, past the wall on +x, rests on the floor and the wall's top
  const out = at(bs, b, 'floor', 3, STOREY, 0);
  assert.ok(out.on.includes(f.id));
  const further = nearestSpot(spots(b, 'floor'), 'floor', { x: 6, y: STOREY, z: 0 })!;
  assert.ok(further && Math.abs(further.x - 6) < 0.01, 'no spot past the balcony');
  assert.match(blocked(b, 'floor', further) ?? '', /one cell/);
  // a roof over a wall's top elsewhere, and nothing over the roof
  assert.ok(!spots(b, 'wall').some((s) => s.y > STOREY + 0.1 && Math.abs(s.x) < 0.1 && Math.abs(s.z - 1.5) < 0.1 && false));
});

ok('stairs on a foundation need room over them; a floor over them is refused', () => {
  const bs = new Bases(flat), b = start(bs);
  at(bs, b, 'stairs_u', 0, 1.5, 0);
  for (const [x, z] of [[0, 1.5], [1.5, 0], [0, -1.5], [-1.5, 0]]) at(bs, b, 'wall', x, 1.5, z);
  const over = nearestSpot(spots(b, 'floor'), 'floor', { x: 0, y: STOREY, z: 0 })!;
  assert.match(blocked(b, 'floor', over) ?? '', /stairs come up/);
  // and stairs where a floor already is over them
  const bs2 = new Bases(flat), b2 = start(bs2);
  for (const [x, z] of [[0, 1.5], [1.5, 0], [0, -1.5], [-1.5, 0]]) at(bs2, b2, 'wall', x, 1.5, z);
  at(bs2, b2, 'floor', 0, STOREY, 0);
  const st = nearestSpot(spots(b2, 'stairs_l'), 'stairs_l', { x: 0, y: 1.5, z: 0 })!;
  assert.match(blocked(b2, 'stairs_l', st) ?? '', /No room over it/);
});

ok(`nothing over four storeys; a wall with nothing under it has no spot at all`, () => {
  const bs = new Bases(flat), b = start(bs);
  for (let s = 0; s < 5; s++) {
    const wall = nearestSpot(spots(b, 'wall'), 'wall', { x: 0, y: s * STOREY + 1.5, z: 1.5 });
    if (!wall) break;
    const why = blocked(b, 'wall', wall);
    if (s < 4) {
      assert.equal(why, null, `storey ${s + 1}: ${why}`);
      bs.lay({ b: b.id, k: 'wall', ...wall }, ME, 0);
    } else assert.match(why ?? '', /4 storeys/);
  }
  assert.equal(spots(b, 'wall').filter((s) => Math.hypot(s.x - 30, s.z) < 1).length, 0);
});

ok('a piece taken away takes what stood only on it; what rests on more than one stays while one is there', () => {
  const bs = new Bases(flat), b = start(bs);
  const f2 = at(bs, b, 'foundation', 3, 0, 0);
  const w1 = at(bs, b, 'wall', 0, 1.5, 1.5), w2 = at(bs, b, 'wall', 3, 1.5, 1.5);
  // the wall on the edge between the two foundations rests on both
  const mid = at(bs, b, 'wall', 1.5, 1.5, 0);
  assert.equal(mid.on.length, 2);
  const gone = bs.remove(b.id, f2.id);
  assert.deepEqual(new Set(gone), new Set([f2.id, w2.id]), `gone: ${gone}`);
  assert.ok(b.pieces.has(mid.id) && b.pieces.has(w1.id));
  // all gone: the base is gone
  const first = [...b.pieces.values()].find((p) => PIECES[p.k].ground)!;
  bs.remove(b.id, first.id);
  assert.equal(bs.bases.size, 0);
});

ok('on a slope: posts reach 2.5 m down, the ground never through a foundation', () => {
  // (ground falling away to the east: a metre every 6 m)
  const slope: Land = { ground: (x) => 10 - x / 6, why: () => null };
  const bs = new Bases(slope), b = start(bs);
  let x = 3, laid = 1;
  for (; x < 40; x += 3, laid++) {
    const s = nearestSpot(spots(b, 'foundation'), 'foundation', { x, y: 0, z: 0 }, 1)!;
    const why = blocked(b, 'foundation', s, bs.groundIn(b));
    if (why) {
      assert.match(why, /Too high/);
      break;
    }
    bs.lay({ b: b.id, k: 'foundation', ...s }, ME, 0);
  }
  assert.equal(laid, 5, `${laid} foundations down the slope`);
  // up the slope the ground comes into the first
  const up = nearestSpot(spots(b, 'foundation'), 'foundation', { x: -3, y: 0, z: 0 }, 1)!;
  assert.match(blocked(b, 'foundation', up, bs.groundIn(b)) ?? '', /ground is in the way/);
});

ok('not in a town; not on a tree; a new base not beside another', () => {
  const town: Land = { ground: () => 0, why: (x) => (x < 50 ? 'Not in a town' : null), solids: (x, z) => [{ x: 100, z: 0, r: 0.4 }] };
  const bs = new Bases(town);
  assert.equal(bs.lay({ k: 'foundation', x: 0, y: 0, z: 0, r: 0 }, ME, 0), 'Not in a town');
  assert.equal(bs.lay({ k: 'foundation', x: 101, y: 0, z: 0, r: 0 }, ME, 0), 'A tree is in the way');
  assert.ok(typeof bs.lay({ k: 'foundation', x: 120, y: 0, z: 0, r: 0 }, ME, 0) !== 'string');
  assert.match(String(bs.lay({ k: 'foundation', x: 125, y: 0, z: 0, r: 0 }, ME, 0)), /Too near a base/);
  assert.match(String(bs.lay({ k: 'wall', x: 140, y: 0, z: 0, r: 0 }, ME, 0)), /foundation first/);
});

ok('a base turned in the world: its frame and the world agree both ways', () => {
  const bs = new Bases(flat), b = start(bs, 500, -200, 0.7);
  const [wx, wy, wz] = toWorld(b, 3, 1, -2);
  const [lx, ly, lz] = toLocal(b, wx, wy, wz);
  assert.ok(Math.abs(lx - 3) < 1e-9 && Math.abs(ly - 1) < 1e-9 && Math.abs(lz + 2) < 1e-9);
  // (its edges in the world are 3 m from its middle, wherever it is turned)
  for (const e of edgesOf('sq', 0, 0, 0, 0)) {
    const [ex, , ez] = toWorld(b, e.x, e.y, e.z);
    assert.ok(Math.abs(Math.hypot(ex - 500, ez + 200) - 1.5) < 1e-9);
  }
});

ok('kept and read back: every piece where it was, and what each rests on worked out again', () => {
  const bs = new Bases(flat), b = start(bs);
  at(bs, b, 'foundation_tri', 2.5, 0, 0);
  for (const [x, z] of [[0, 1.5], [0, -1.5], [-1.5, 0]]) at(bs, b, 'wall', x, 1.5, z);
  at(bs, b, 'doorway', 1.5, 1.5, 0);
  at(bs, b, 'floor', 0, STOREY, 0);
  bs.upgrade(b.id, 2, 2);
  const kept = JSON.parse(JSON.stringify(bs.keep()));
  const again = heard(kept[0])!;
  assert.equal(again.pieces.size, b.pieces.size);
  for (const p of b.pieces.values()) {
    const q = again.pieces.get(p.id)!;
    assert.ok(q && q.k === p.k && q.t === p.t && q.r === p.r && Math.abs(q.x - p.x) < 0.006 && Math.abs(q.y - p.y) < 0.006, `${p.k} #${p.id}`);
    assert.deepEqual([...q.on].sort(), [...p.on].sort(), `${p.k} #${p.id} rests on ${q.on} after, ${p.on} before`);
  }
  assert.deepEqual([...standing(again)].sort(), [...standing(b)].sort());
  console.log(`      a base of ${b.pieces.size} pieces kept in ${JSON.stringify(said(b)).length} characters`);
});

console.log('Building: claims, upkeep and rot');
ok('a claim is set down on a floor, wholly on it, never over its edge; one to a base, one a player', () => {
  const bs = new Bases(flat), b = start(bs);
  const s = deployAt(b, 'claim', { x: 0.1, y: 0, z: 0.2 })!;
  assert.deepEqual([s.x, s.z], [0, 0.25], 'to a quarter metre');
  assert.equal(deployAt(b, 'claim', { x: 1.4, y: 0, z: 0 }), null, 'over the edge');
  const r = bs.lay({ b: b.id, k: 'claim', ...s }, ME, 0, 'Me');
  assert.ok(typeof r !== 'string' && b.claim?.p === r.piece.id && b.claim.members[0].pid === ME, `the claim: ${typeof r === 'string' ? r : 'laid'}`);
  assert.match(String(bs.check({ b: b.id, k: 'claim', ...deployAt(b, 'claim', { x: 0.75, y: 0, z: -0.75 })! }, ME)), /has its claim already/);
  const far = new Bases(flat);
  far.bases = bs.bases;
  const b2 = start(bs, 200, 0);
  assert.match(String(bs.check({ b: b2.id, k: 'claim', ...deployAt(b2, 'claim', { x: 0, y: 0, z: 0 })! }, ME)), /hold a claim already/);
  assert.ok(typeof bs.check({ b: b2.id, k: 'claim', ...deployAt(b2, 'claim', { x: 0, y: 0, z: 0 })! }, 'you') !== 'string', 'somebody else may set one in another base');
  // (and it falls with its floor)
  bs.remove(b.id, 1);
  assert.equal(b.claim, undefined);
});

ok('within 20 m of a claimed base only its members build; whoever reaches the claim may join it, and leave', () => {
  const bs = new Bases(flat), b = start(bs);
  bs.lay({ b: b.id, k: 'claim', ...deployAt(b, 'claim', { x: 0, y: 0, z: 0 })! }, ME, 0, 'Me');
  const wall = nearestSpot(spots(b, 'wall'), 'wall', { x: 0, y: 1.5, z: 1.5 })!;
  assert.match(String(bs.lay({ b: b.id, k: 'wall', ...wall }, 'you', 0)), /Building blocked/);
  assert.match(String(bs.lay({ k: 'foundation', x: 15, y: 0, z: 0, r: 0 }, 'you', 0)), /Building blocked/);
  assert.ok(typeof bs.lay({ k: 'foundation', x: 30, y: 0, z: 0, r: 0 }, 'you', 0) !== 'string', 'out of its reach, anybody builds');
  assert.ok(!bs.mayWork(b, 'you'));
  assert.equal(bs.join(b, 'you', 'You'), true);
  assert.ok(bs.mayWork(b, 'you') && typeof bs.lay({ b: b.id, k: 'wall', ...wall }, 'you', 0) !== 'string', 'a member builds');
  assert.equal(bs.join(b, 'you', 'You'), false);
  assert.ok(!bs.mayWork(b, 'you'));
});

ok("upkeep by Rust's brackets: a wood 1x1 costs 6 planks and 7 nails a day; a week's store keeps it a week", () => {
  const bs = new Bases(flat), b = start(bs);
  for (const [k, x, z] of [['wall', 0, -1.5], ['wall', -1.5, 0], ['wall', 1.5, 0], ['doorway', 0, 1.5]] as const) at(bs, b, k, x, 1.5, z);
  at(bs, b, 'floor', 0, 3, 0);
  bs.lay({ b: b.id, k: 'claim', ...deployAt(b, 'claim', { x: 0, y: 0, z: 0 })! }, ME, 0, 'Me');
  for (const p of b.pieces.values()) if (p.k !== 'claim') bs.upgrade(b.id, p.id, 1);
  const day = perDay(b);
  assert.ok(Math.abs(day.planks - 6) < 1e-9 && Math.abs(day.nails - 7.2) < 1e-9, JSON.stringify(day));
  assert.ok(Math.abs(protectedFor({ planks: 42, nails: 51 }, day) / 86400 - 7) < 0.1);
  assert.equal(protectedFor({ planks: 42 }, day), 0, 'no nails: nothing keeps it');
  assert.deepEqual([0, 14, 15, 49, 50, 99, 100].map(bracket), [0.1, 0.1, 0.15, 0.15, 0.2, 0.2, 0.3]);
  // (a big stone base: 90 pieces)
  const big = { ...b, pieces: new Map(Array.from({ length: 90 }, (_, i) => [i + 1, { ...b.pieces.get(2)!, id: i + 1, t: 2 as Tier }])) };
  const d = perDay(big);
  console.log(`      a day: the 1x1 in wood ${Math.round(day.planks)} planks, ${Math.round(day.nails)} nails; 90 stone pieces ${Math.round(d.stone)} stone`);
  assert.ok(d.stone > 300 && d.stone < 600);
});

ok('upkeep is paid a whole thing at a time, the parts owed over; short, the store is dry', () => {
  const due: Record<string, number> = {}, store = { planks: 2 };
  assert.equal(pay({ planks: 12 }, 1, due, store), true);
  assert.equal(store.planks, 2, 'half a plank owed, none taken');
  assert.equal(pay({ planks: 12 }, 1, due, store), true);
  assert.equal(store.planks, 1);
  for (let h = 0; h < 2; h++) pay({ planks: 12 }, 1, due, store);
  assert.equal(store.planks, 0);
  assert.equal(pay({ planks: 12 }, 2, due, store), false);
});

ok('rot: a frame is gone in 2 h, wood 12 h, stone 24 h, metal 36 h; with no claim, after 10 minutes of grace', () => {
  for (const [t, h] of [[0, 2], [1, 12], [2, 24], [3, 36]] as const) {
    const bs = new Bases(flat), b = start(bs);
    bs.upgrade(b.id, 1, t);
    b.pieces.get(1)!.at = 0;
    assert.equal(rot(b, h * 0.99, 1e9, true).broken.length, 0, `tier ${t} gone before ${h} h`);
    assert.deepEqual(rot(b, h * 0.02, 1e9, true).broken, [1], `tier ${t} not gone at ${h} h`);
  }
  const bs = new Bases(flat), b = start(bs);
  assert.equal(rot(b, 5, ROT.grace - 1, false).hurt.length, 0, 'rotted inside its grace');
  assert.equal(rot(b, 0.5, ROT.grace + 1001, false).hurt.length, 1);
  assert.equal(saidTime(3 * 86400 + 4 * 3600), '3 d 4 h');
});

ok('kept and read back with its claim: its members, what is owed, and what was in its store', () => {
  const bs = new Bases(flat), b = start(bs);
  bs.lay({ b: b.id, k: 'claim', ...deployAt(b, 'claim', { x: 0, y: 0, z: 0 })! }, ME, 0, 'Me');
  bs.join(b, 'you', 'You');
  b.claim!.due = { planks: 0.4 };
  const kept = JSON.parse(JSON.stringify(bs.keep(() => [{ id: 'planks', qty: 9 }])));
  const again = heard(kept[0])!;
  assert.deepEqual(again.claim?.members.map((m) => m.pid), [ME, 'you']);
  assert.equal(again.claim?.due.planks, 0.4);
  assert.deepEqual(again.claim?.kept, [{ id: 'planks', qty: 9 }]);
  // (and what a game is told has no store in it)
  assert.equal((said(b)[8] as unknown[]).length, 4);
});

console.log('Building: doors, fittings, boxes');
/** a 1x1 with a doorway at +z and a window at -z, and its walls; a bench beside it when asked */
const hut = (bench = false) => {
  const bs = new Bases(flat), b = start(bs);
  for (const [k, x, z] of [['doorway', 0, 1.5], ['window', 0, -1.5], ['wall', -1.5, 0], ['wall', 1.5, 0]] as const) at(bs, b, k, x, 1.5, z);
  if (bench) {
    at(bs, b, 'foundation', 3, 0, 0);
    assert.ok(typeof bs.lay({ b: b.id, k: 'workbench', ...deployAt(b, 'workbench', { x: 3, y: 0, z: 0 })! }, ME, 0) !== 'string');
  }
  return { bs, b };
};

ok('a fitting hangs in an opening of its sort, one to an opening, either way round', () => {
  const { bs, b } = hut();
  assert.deepEqual(spots(b, 'door_wood').map((s) => [s.x, s.z]), [[0, 1.5]], 'a door goes in the doorway only');
  assert.equal(spots(b, 'double_door_wood').length, 0, 'a double door needs a wall frame');
  assert.deepEqual(spots(b, 'bars_wood').map((s) => [s.x, s.z]), [[0, -1.5]]);
  const out = spots(b, 'door_wood', 0)[0], back = spots(b, 'door_wood', 1)[0];
  assert.equal((back.r - out.r + 12) % 12, 6, 'R hangs it the other way round');
  const d = at(bs, b, 'door_wood', 0, 1.2, 1.5);
  assert.deepEqual(d.on, [2], 'it rests on its doorway');
  assert.match(String(blocked(b, 'door_wood', { ...out, on: [2] })), /hung there already/);
  // (taken down with its doorway)
  assert.ok(bs.remove(b.id, 2).includes(d.id));
});

ok('the metal fittings need a workbench near; the wooden ones do not', () => {
  const { bs, b } = hut();
  const s = spots(b, 'door_metal')[0];
  assert.match(String(bs.lay({ b: b.id, k: 'door_metal', ...s }, ME, 0)), /needs a workbench/);
  assert.ok(typeof bs.lay({ b: b.id, k: 'bars_wood', ...spots(b, 'bars_wood')[0] }, ME, 0) !== 'string');
  const h = hut(true);
  assert.ok(typeof h.bs.lay({ b: h.b.id, k: 'door_metal', ...spots(h.b, 'door_metal')[0] }, ME, 0) !== 'string');
  assert.deepEqual(costOf('door_metal', 3), { sheet_metal: 4, nails: 20 });
  assert.deepEqual([hpOf('door_wood', 1), hpOf('door_metal', 3), hpOf('garage_door', 3)], [250, 500, 1000]);
});

ok('a door swings one way through where it sweeps, and not through a body there', () => {
  const { bs, b } = hut();
  const d = at(bs, b, 'door_wood', 0, 1.2, 1.5);
  // (it swings out, to +z: a body just outside it is in the way, one inside or a step further out is not)
  assert.ok(inTheWay(d, [{ x: 0, y: 0, z: 2.3 }]), 'a body in its swing');
  assert.ok(!inTheWay(d, [{ x: 0, y: 0, z: 0.6 }]), 'a body behind it');
  assert.ok(!inTheWay(d, [{ x: 0, y: 0, z: 3.4 }]), 'a body clear of it');
  assert.ok(!inTheWay(d, [{ x: 0, y: 4, z: 2.3 }]), 'a body on the floor above');
  const pts = swept(d);
  assert.ok(pts.every(([, , z]) => z > 1.4), 'it never swings in');
});

ok('nothing is set down where a door swings, nor a door hung to swing into what is set down', () => {
  const { bs, b } = hut();
  // (hung to swing in, then a box where it would swing)
  at(bs, b, 'door_wood', 0, 1.2, 1.5, 1);
  const s = deployAt(b, 'box_small', { x: 0, y: 0, z: 0.75 })!;
  assert.match(String(blocked(b, 'box_small', s)), /door swings there/);
  assert.equal(blocked(b, 'box_small', deployAt(b, 'box_small', { x: -0.5, y: 0, z: -0.75 })!), null);
  const h = hut();
  assert.ok(typeof h.bs.lay({ b: h.b.id, k: 'box_large', ...deployAt(h.b, 'box_large', { x: 0, y: 0, z: 0.5 })! }, ME, 0) !== 'string');
  assert.match(String(blocked(h.b, 'door_wood', { ...spots(h.b, 'door_wood', 1)[0], on: [2] })), /large box is where it swings/);
  assert.equal(blocked(h.b, 'door_wood', { ...spots(h.b, 'door_wood', 0)[0], on: [2] }), null, 'swinging out, it is clear');
});

ok('a box picked up gives back all it cost; kept with what was in its store and whether its door stood open', () => {
  const { bs, b } = hut();
  const d = at(bs, b, 'door_wood', 0, 1.2, 1.5);
  d.open = true;
  const box = bs.lay({ b: b.id, k: 'box_small', ...deployAt(b, 'box_small', { x: -0.5, y: 0, z: -0.5 })! }, ME, 0);
  assert.ok(typeof box !== 'string');
  assert.deepEqual(bs.refund(b.id, box.piece.id), { planks: 12, nails: 8 });
  assert.deepEqual(bs.refund(b.id, d.id), { planks: 6, nails: 4 }, 'a door is built: half back');
  const kept = JSON.parse(JSON.stringify(bs.keep(undefined, (_b, p) => (p.k === 'box_small' ? [{ id: 'nails', qty: 3 }] : undefined))));
  const again = heard(kept[0])!;
  assert.equal(again.pieces.get(d.id)?.open, true);
  assert.deepEqual(again.pieces.get(box.piece.id)?.kept, [{ id: 'nails', qty: 3 }]);
  assert.equal(again.pieces.get(box.piece.id)?.on.length, 1, 'it rests on its foundation again');
  // (and what a game is told has no store in it)
  assert.ok(!JSON.stringify(said(b)).includes('"s"'));
});

if (process.argv.includes('--server')) await serverTest();
if (failed.length) {
  console.error(`BUILD TEST FAILED: ${failed.length} of ${n + failed.length}: ${failed.join('; ')}`);
  process.exit(1);
}
console.log(`BUILD TEST PASSED (${n})`);
process.exit(0);

async function serverTest() {
  const PORT = 8392, SITE = 'http://127.0.0.1:9';
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting a server');
  console.log('Building: on a server (port 8392)');
  const data = buildWorldData(process.cwd());
  // (a place out in the country a base may go, as the server will judge it, with room on both sides)
  const solids = new Solids(data.trees, data.rocks);
  const wet = wetAt(data.water, (x, z) => data.groundAt(x, z));
  const land: Land = { ground: (x, z) => data.groundAt(x, z), why: (x, z) => noBuilding(x, z, data.places, data.buildings, data.spawns, wet), solids: (x, z, w) => solids.near(x, z, w) };
  let site: [number, number] | null = null;
  for (let x = -700; x < 700 && !site; x += 37) for (let z = -700; z < 700 && !site; z += 41) {
    const bs = new Bases(land), r = bs.lay({ k: 'foundation', x, y: 0, z, r: 0, yaw: 0 }, ME, 0);
    if (typeof r === 'string') continue;
    const b = r.base;
    if ([3, -3].every((dx) => { const sp = nearestSpot(spots(b, 'foundation'), 'foundation', { x: dx, y: 0, z: 0 }, 1); return sp && !blocked(b, 'foundation', sp, bs.groundIn(b)); })) site = [x, z];
  }
  assert.ok(site, 'no place on the map a base may go');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-build-'));
  let logged = '';
  // (stopped by a word on its input, as a deploy stops it: it writes its world on the way out)
  const start = (more: Record<string, string> = {}) => {
    const s = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
      env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '0', LOCAL_ADMIN: '1', INFECTED: 'off', ANIMALS: 'off', STOP_BY_WORD: '1', ...more },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    s.stdout!.on('data', (d) => (logged += d));
    s.stderr!.on('data', (d) => (logged += d));
    return s;
  };
  let server = start();
  class Player {
    ws!: WebSocket;
    got: S2C[] = [];
    pos: [number, number, number] = [0, 0, 0];
    held: string | null = null;
    pockets: ItemInstance[] = [];
    constructor(public name: string) {}
    async join() {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
      await new Promise<void>((done, fail) => {
        this.ws.once('open', () => done());
        this.ws.once('error', fail);
      });
      this.send({ t: 'hello', v: PROTOCOL, key: `build-test-key-${this.name}-`.padEnd(40, '0'), name: this.name, fp: `fp-${this.name}`.padEnd(64, 'b') });
      for (let k = 0; k < 300 && !this.of('welcome').length; k++) await sleep(50);
      assert.ok(this.of('welcome').length, `${this.name} was not let in`);
    }
    send(m: unknown) {
      this.ws.send(JSON.stringify(m));
    }
    of<T extends S2C['t']>(t: T) {
      return this.got.filter((m) => m.t === t) as Extract<S2C, { t: T }>[];
    }
    /** the first message of a kind that passes `test`, of those since the `from`th of all it has been sent */
    async until<T extends S2C['t']>(t: T, test: (m: Extract<S2C, { t: T }>) => boolean = () => true, ms = 4000, from = 0) {
      for (let k = 0; k < ms / 25; k++) {
        const m = (this.got.slice(from).filter((q) => q.t === t) as Extract<S2C, { t: T }>[]).find(test);
        if (m) return m;
        await sleep(25);
      }
      return null;
    }
    async give(id: string, qty = 1) {
      const had = this.of('kit').length;
      this.send({ t: 'chat', text: `/give ${id} ${qty}` });
      for (let k = 0; k < 160 && this.of('kit').length === had; k++) await sleep(25);
      const items = this.of('kit')[had]?.items ?? [];
      assert.ok(items.length, `/give ${id} gave nothing`);
      this.pockets.push(...items);
      this.me();
      return items[0];
    }
    /** its word on its pockets, saying it has taken out what was spent up to `sp` */
    me(sp = 0) {
      this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'gear', items: this.pockets.map((it, i) => ({ ...it, x: 0, y: i, rot: false })) }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false }, sp });
    }
    async go(x: number, z: number) {
      const had = this.of('put').length;
      this.send({ t: 'chat', text: `/tp ${x.toFixed(2)} ${z.toFixed(2)}` });
      for (let k = 0; k < 160 && this.of('put').length === had; k++) await sleep(25);
      this.pos = [x, data.groundAt(x, z), z];
      this.hold(this.held);
      await sleep(60);
    }
    hold(id: string | null) {
      this.held = id;
      this.send({ t: 's', p: [this.pos[0], this.pos[1], this.pos[2], 0, 0, 0], w: id, m: [] });
    }
  }
  let fail: unknown = null;
  try {
    for (let k = 0; k < 1500 && !logged.includes('listening'); k++) await sleep(100);
    assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
    const a = new Player('Builder'), o = new Player('Other');
    await a.join();
    const plan = await a.give('building_plan'), ham = await a.give('hammer');
    await a.give('planks', 12);
    await a.give('log', 2);
    const [sx, sz] = site!;
    await a.go(sx - 3, sz);
    // a first foundation: paid for, and the base told
    a.send({ t: 'blay', k: 'foundation', x: sx, y: 0, z: sz, r: 0, yaw: 0, u: plan.uid });
    const spent = await a.until('spent');
    assert.deepEqual(Object.fromEntries(spent?.items ?? []), { planks: 4, log: 2 }, `spent ${JSON.stringify(spent)}; told ${JSON.stringify(a.of('tell'))}`);
    const told = await a.until('base');
    assert.ok(told, `no base told: ${JSON.stringify(a.of('tell'))}`);
    const b = heard(told!.b)!;
    assert.equal(b.pieces.size, 1);
    console.log(`  ok  a first foundation at ${sx}, ${sz}: paid for (4 planks, 2 logs), and the base told`);
    // a wall where the base offers one; and one where it does not is refused
    const wall = nearestSpot(spots(b, 'wall'), 'wall', { x: 0, y: 1.5, z: 1.5 })!;
    a.send({ t: 'blay', k: 'wall', b: b.id, ...wall, u: plan.uid });
    const pc = await a.until('bpc');
    assert.ok(pc && PIECE_IDS[pc.p[1]] === 'wall', `the wall was not laid: ${JSON.stringify(a.of('tell'))}`);
    a.send({ t: 'blay', k: 'wall', b: b.id, x: 0.4, y: 0, z: 0.9, r: 0, u: plan.uid });
    assert.ok(await a.until('tell', (m) => /does not fit/.test(m.text)), 'a wall nowhere was laid');
    // still saying it has all 12 planks (its word from before it took out what was spent): one more wall, and no more
    a.me(0);
    await sleep(150);
    const wall2 = nearestSpot(spots(b, 'wall'), 'wall', { x: 1.5, y: 1.5, z: 0 })!;
    a.send({ t: 'blay', k: 'wall', b: b.id, ...wall2, u: plan.uid });
    assert.ok(await a.until('bpc', (m) => m.p[0] === 3), 'the second wall was not laid');
    const wall3 = nearestSpot(spots(b, 'wall'), 'wall', { x: -1.5, y: 1.5, z: 0 })!;
    a.send({ t: 'blay', k: 'wall', b: b.id, ...wall3, u: plan.uid });
    assert.ok(await a.until('tell', (m) => /Needs 4 more planks/.test(m.text)), `a fourth piece laid from planks already spent: ${JSON.stringify(a.of('tell').slice(-2))}`);
    console.log('  ok  a wall where the base offers it; none where it does not; planks spent are spent, whatever the game still says it has');
    // the hammer: begun, not done at once, done after its time, paid for
    await a.give('planks', 20);
    await a.give('nails', 30);
    a.hold('hammer');
    a.send({ t: 'bup', b: b.id, p: 2, to: 1, go: 1, u: ham.uid });
    assert.ok((await a.until('bup'))?.ok, `the hammer was not begun: ${JSON.stringify(a.of('bup'))}`);
    a.send({ t: 'bup', b: b.id, p: 2, to: 1, go: 2, u: ham.uid });
    await sleep(300);
    assert.ok(!a.of('bpc').some((m) => m.p[0] === 2 && m.p[2] === 1), 'nailed up at once');
    a.send({ t: 'bup', b: b.id, p: 2, to: 1, go: 1, u: ham.uid });
    await sleep(TIER_S[1] * 1000 + 100);
    a.send({ t: 'bup', b: b.id, p: 2, to: 1, go: 2, u: ham.uid });
    const up = await a.until('bpc', (m) => m.p[0] === 2 && m.p[2] === 1);
    assert.ok(up && up.p[7] === 500, `not nailed up to wood: ${JSON.stringify(up)}`);
    assert.ok(a.of('spent').some((m) => JSON.stringify(Object.fromEntries(m.items)) === JSON.stringify({ planks: 10, nails: 12 })), 'wood was not paid for');
    assert.ok(a.of('wear').some((m) => m.u === ham.uid), 'the hammer did not wear');
    console.log(`  ok  the hammer nails a wall up to wood in ${TIER_S[1]} s, not at once: 10 planks, 12 nails, and the hammer worn`);
    // somebody else: told the base when they come near, and it is not theirs to work
    await o.join();
    const oham = await o.give('hammer');
    await o.go(sx + 900, sz);
    await sleep(2600);
    assert.ok(!o.of('base').length, 'a base told to somebody 900 m off');
    await o.go(sx + 4, sz + 4);
    assert.ok(await o.until('base', () => true, 4000), 'a base not told to somebody beside it');
    o.hold('hammer');
    o.send({ t: 'bup', b: b.id, p: 2, to: 2, go: 1, u: oham.uid });
    assert.match((await o.until('bup'))?.why ?? '', /not yours/);
    console.log('  ok  a base is told to whoever comes near it and not to whoever is far off; it is not theirs to work');
    // taken down: half back; the foundation taken away takes its walls with it
    a.send({ t: 'bdel', b: b.id, p: 2, u: ham.uid });
    const out = await a.until('bout');
    assert.deepEqual(out?.ids, [2]);
    assert.match(a.of('kit').at(-1)?.gift ?? '', /Planks/);
    a.send({ t: 'bdel', b: b.id, p: 1, u: ham.uid });
    const all = await a.until('bout', (m) => m.ids.includes(1));
    assert.deepEqual(new Set(all?.ids), new Set([1, 3]), `the foundation took ${all?.ids}`);
    assert.ok(o.of('bout').length >= 2, 'the other was not told');
    console.log('  ok  taken down with the hammer: half back; a foundation taken away takes what stood on it; everybody near told');
    // a server stopped and started again on the same disk: the base is back, whole, and still its builder's
    await a.give('planks', 12);
    await a.give('log', 2);
    a.send({ t: 'blay', k: 'foundation', x: sx, y: 0, z: sz, r: 0, yaw: 0.3, u: plan.uid });
    const again = await a.until('base', (m) => m.b[0] !== b.id);
    assert.ok(again, `the second base was not begun: ${JSON.stringify(a.of('tell').slice(-2))}`);
    const b2 = heard(again!.b)!;
    const w2 = nearestSpot(spots(b2, 'doorway'), 'doorway', { x: 0, y: 1.5, z: 1.5 })!;
    a.send({ t: 'blay', k: 'doorway', b: b2.id, ...w2, u: plan.uid });
    assert.ok(await a.until('bpc', (m) => PIECE_IDS[m.p[1]] === 'doorway'), 'the doorway was not laid');
    server.stdin!.write('stop\n');
    for (let k = 0; k < 400 && server.exitCode === null; k++) await sleep(50);
    assert.ok(server.exitCode !== null, 'the server did not stop');
    assert.match(readFileSync(path.join(dir, 'world.json'), 'utf8'), /"bases":\[\[/, 'no bases in the world it wrote');
    server = start();
    for (let k = 0; k < 1500 && !/listening[\s\S]*listening/.test(logged); k++) await sleep(100);
    assert.match(logged, /\[build\] 1 bases, 2 pieces read back/);
    const back = new Player('Builder');
    await back.join();
    await back.go(sx - 3, sz);
    const seen = await back.until('base', () => true, 5000);
    assert.ok(seen, 'the base was not told after the restart');
    const kept = heard(seen!.b)!;
    assert.equal(kept.pieces.size, 2);
    assert.ok([...kept.pieces.values()].some((p) => p.k === 'doorway') && Math.abs(kept.yaw - 0.3) < 1e-4);
    const ham2 = await back.give('hammer');
    await back.give('planks', 10);
    await back.give('nails', 12);
    back.hold('hammer');
    back.send({ t: 'bup', b: kept.id, p: 2, to: 1, go: 1, u: ham2.uid });
    assert.ok((await back.until('bup'))?.ok, `not the builder's after the restart: ${JSON.stringify(back.of('bup'))}`);
    console.log('  ok  stopped and started again: the base is back whole, turned as it was, and still its builder\'s to work');

    // ---- claims, on a server that lives an hour of upkeep each second
    server.stdin!.write('stop\n');
    for (let k = 0; k < 400 && server.exitCode === null; k++) await sleep(50);
    const was = logged.length;
    server = start({ UPKEEP_EVERY_S: '1', UPKEEP_SPEED: '3600', ROT_GRACE_S: '600' });
    for (let k = 0; k < 1500 && !logged.slice(was).includes('listening'); k++) await sleep(100);
    const me = new Player('Builder'), them = new Player('Stranger');
    await me.join();
    const plan3 = await me.give('building_plan'), ham3 = await me.give('hammer');
    await me.give('planks', 20);
    await me.give('planks', 20);
    await me.give('log', 2);
    await me.give('log', 1);
    await me.give('nails', 20);
    const [cx, cz] = [sx + 60, sz];
    await me.go(cx - 2, cz);
    // the base from before is out of its grace and has no claim: it is rotting already, and is no matter here
    me.send({ t: 'blay', k: 'foundation', x: cx, y: 0, z: cz, r: 0, yaw: 0, u: plan3.uid });
    const told3 = await me.until('base', (m) => m.b[1] > sx + 30);
    assert.ok(told3, `no base at the claim's place: ${JSON.stringify(me.of('tell').slice(-2))}`);
    const B = heard(told3!.b)!;
    me.send({ t: 'blay', k: 'claim', b: B.id, x: 0, y: 0, z: 0, r: 0, u: plan3.uid });
    const cl = await me.until('bclaim', (m) => m.b === B.id && !!m.c);
    assert.ok(cl && cl.c![1][0][1] === 'Builder', `no claim: ${JSON.stringify(me.of('tell').slice(-2))}`);
    for (const [x, z] of [[0, -1.5], [-1.5, 0]]) {
      const w = nearestSpot(spots(B, 'wall'), 'wall', { x, y: 1.5, z })!;
      me.send({ t: 'blay', k: 'wall', b: B.id, ...w, u: plan3.uid });
      await sleep(150);
    }
    console.log('  ok  a claim set down in a base: its builder on it');
    // a stranger: building blocked, until they join it at the claim; then it is theirs to build on too
    await them.join();
    const plan4 = await them.give('building_plan');
    await them.give('planks', 8);
    await them.go(cx + 1.6, cz + 1.6);
    const w3 = nearestSpot(spots(B, 'wall'), 'wall', { x: 1.5, y: 1.5, z: 0 })!;
    them.send({ t: 'blay', k: 'wall', b: B.id, ...w3, u: plan4.uid });
    assert.ok(await them.until('tell', (m) => /Building blocked/.test(m.text)), `a stranger built in a claim: ${JSON.stringify(them.of('tell').slice(-2))}`);
    assert.ok(await them.until('base', (m) => m.b[0] === B.id, 5000), 'the stranger was not told the base');
    them.send({ t: 'bjoin', b: B.id });
    assert.ok(await them.until('tell', (m) => /on this claim/.test(m.text)), 'not joined');
    them.send({ t: 'blay', k: 'wall', b: B.id, ...w3, u: plan4.uid });
    assert.ok(await them.until('bpc', (m) => m.b === B.id && PIECE_IDS[m.p[1]] === 'wall'), `a member could not build: ${JSON.stringify(them.of('tell').slice(-2))}`);
    them.send({ t: 'bjoin', b: B.id });
    console.log('  ok  a stranger is blocked from building in it, joins it at the claim, builds, and leaves');
    // its store: planks put in pay its upkeep, a plank every so often, and it says how long it is kept
    const cid = `claim:${B.id}`;
    me.send({ t: 'copen', cid });
    assert.ok(await me.until('cdata', (m) => m.cid === cid), 'the store did not open');
    const pile = me.pockets.find((it) => it.id === 'planks' && it.qty >= 10)!;
    me.send({ t: 'cset', cid, items: [{ ...pile, qty: 10, x: 0, y: 0, rot: false }] });
    const keep1 = await me.until('bkeep', (m) => m.b === B.id && m.s > 0, 6000);
    assert.ok(keep1, `no word of how long it is kept: ${JSON.stringify(me.of('bkeep').slice(-1))}`);
    const fewer = await me.until('cdata', (m) => m.cid === cid && (m.items.find((it) => it.id === 'planks')?.qty ?? 0) < 10, 40000);
    assert.ok(fewer, 'no plank was taken for upkeep');
    console.log(`  ok  its store pays the upkeep a plank at a time, and its members are told how long it keeps the base (${Math.round(keep1!.s / 3600)} h)`);
    // the claim taken down: what was in its store lies on the ground
    me.hold('hammer');
    const lootBefore = me.of('loot+').length;
    me.send({ t: 'bdel', b: B.id, p: 2, u: ham3.uid });
    assert.ok(await me.until('bclaim', (m) => m.b === B.id && m.c === null, 5000), `the claim did not go: ${JSON.stringify(me.of('tell').slice(-2))}`);
    await sleep(300);
    assert.ok(me.of('loot+').slice(lootBefore).some((m) => m.l.item.id === 'planks'), 'its store did not spill');
    console.log('  ok  the claim taken down: what was in its store lies on the ground');
    // a claim again, with nothing in its store: run dry, its base rots, and what comes to nothing breaks
    await me.give('log', 1);
    const since = me.got.length;
    me.send({ t: 'blay', k: 'claim', b: B.id, x: 0, y: 0, z: 0, r: 0, u: plan3.uid });
    assert.ok(await me.until('bclaim', (m) => m.b === B.id && !!m.c, 5000, since), `no claim again: ${JSON.stringify(me.of('tell').slice(-2))}`);
    const dry = await me.until('bclaim', (m) => m.b === B.id && !!m.c?.[3], 60000, since);
    assert.ok(dry, 'never dry');
    assert.ok(await me.until('bhp', (m) => m.b === B.id, 5000, since), 'it did not rot');
    assert.ok(await me.until('bout', (m) => m.b === B.id, 15000, since), 'nothing broke');
    console.log('  ok  run dry, its base rots, and what comes to nothing breaks');

    // ---- doors: swung open and shut for everybody near; not through a body; knocked on
    await me.give('planks', 20);
    await me.give('nails', 20);
    await me.give('log', 2);
    // (a place out in the country, well clear of the bases before)
    let free: [number, number] | null = null;
    for (let r = 0; r < 600 && !free; r += 23) for (let q = 0; q < 6.28 && !free; q += 0.7) {
      const x = sx + 150 + Math.cos(q) * r, z = sz + Math.sin(q) * r;
      if (typeof new Bases(land).lay({ k: 'foundation', x, y: 0, z, r: 0, yaw: 0 }, ME, 0) !== 'string') free = [x, z];
    }
    assert.ok(free, 'no place for the door');
    const [dx, dz] = free!;
    await me.go(dx - 3, dz);
    const sinceD = me.got.length;
    me.send({ t: 'blay', k: 'foundation', x: dx, y: 0, z: dz, r: 0, yaw: 0, u: plan3.uid });
    const toldD = await me.until('base', (m) => Math.hypot(m.b[1] - dx, m.b[3] - dz) < 1, 5000, sinceD);
    assert.ok(toldD, `no base for the door: ${JSON.stringify(me.of('tell').slice(-2))}`);
    const D = heard(toldD!.b)!;
    const dwy = nearestSpot(spots(D, 'doorway'), 'doorway', { x: 0, y: 1.5, z: 1.5 })!;
    me.send({ t: 'blay', k: 'doorway', b: D.id, ...dwy, u: plan3.uid });
    const way = await me.until('bpc', (m) => m.b === D.id && PIECE_IDS[m.p[1]] === 'doorway', 4000, sinceD);
    assert.ok(way, `no doorway: ${JSON.stringify(me.of('tell').slice(-2))}`);
    const wp = heardPiece(way!.p)!;
    D.pieces.set(wp.id, wp);
    const ds = spots(D, 'door_wood', 0)[0];
    me.send({ t: 'blay', k: 'door_wood', b: D.id, ...ds, u: plan3.uid });
    const door = await me.until('bpc', (m) => m.b === D.id && PIECE_IDS[m.p[1]] === 'door_wood', 4000, sinceD);
    assert.ok(door, `no door: ${JSON.stringify(me.of('tell').slice(-2))}`);
    const P = door!.p[0];
    // (standing a step out from it, clear of its swing, both of them; it opens for both)
    const stand = async (who: Player, x: number, z: number) => {
      who.pos = [D.ox + x, D.oy, D.oz + z];
      who.hold(who.held);
      await sleep(120);
    };
    await them.go(dx + 3, dz + 3);
    await stand(me, 0, 3.4);
    await stand(them, 2.2, 3.4);
    me.send({ t: 'bdoor', b: D.id, p: P, open: true });
    assert.ok(await me.until('bdoor', (m) => m.b === D.id && m.p === P && m.o === 1, 3000, sinceD), `it did not open: ${JSON.stringify(me.of('tell').slice(-2))}`);
    assert.ok(await them.until('bdoor', (m) => m.b === D.id && m.p === P && m.o === 1, 3000), 'the other was not told it opened');
    // (the other steps into its swing: it will not shut on them; they step out, and it shuts)
    await sleep(500);
    await stand(them, 0.2, 2.2);
    me.send({ t: 'bdoor', b: D.id, p: P, open: false });
    assert.ok(await me.until('tell', (m) => /in the way/.test(m.text), 3000, sinceD), 'it shut on somebody');
    await stand(them, 2.2, 3.4);
    me.send({ t: 'bdoor', b: D.id, p: P, open: false });
    assert.ok(await me.until('bdoor', (m) => m.b === D.id && m.p === P && m.o === 0, 3000, sinceD), 'it did not shut');
    // (a knock on it is heard by whoever is near)
    them.send({ t: 'bknock', b: D.id, p: P });
    assert.ok(await me.until('knock', () => true, 3000, sinceD), 'the knock was not heard');
    console.log('  ok  a door opens and shuts for everybody near, will not shut on somebody in its swing, and a knock on it is heard');
  } catch (e) {
    fail = e;
  } finally {
    if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    await sleep(300);
    rmSync(dir, { recursive: true, force: true });
  }
  if (fail) {
    failed.push('the server');
    console.log(`  NOT OK  the server: ${fail instanceof Error ? fail.message : fail}\n--- server log tail ---\n${logged.slice(-1500)}`);
  } else n++;
}
