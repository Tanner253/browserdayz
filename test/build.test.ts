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
import { F_DEAD, PROTOCOL, type S2C } from '../src/net/protocol';
import type { ItemInstance } from '../src/sim/items';
import { buildWorldData } from '../server/world';
import { Solids, noBuilding, wetAt } from '../src/sim/build/land';
import { BUILDING_FOOTPRINT, PLAN, onRidgeWall } from '../src/world/worldgen';
import { inPlay } from '../src/world/worldgen/layout';
import { Bases, MEND, heard, heardPiece, repairOf, said, saidPiece, type Land } from '../src/sim/build/bases';
import { CELL, PIECES, PIECE_IDS, STOREY, TIER_S, benchLevel, costOf, hpOf, type Tier } from '../src/sim/build/pieces';
import { blocked, deployAt, edgesOf, nearestSpot, spots, standing, toLocal, toWorld, type Base, type Piece } from '../src/sim/build/snap';
import { ROT, bracket, pay, perDay, protectedFor, rot, saidTime } from '../src/sim/build/upkeep';
import { inBase, inTheWay, swept } from '../src/sim/build/doors';
import { BaseSolids } from '../src/sim/build/solid';
import { inRoom, shutRoom } from '../src/sim/build/rooms';
import { lockable, mayPass } from '../src/sim/build/locks';
import { PRINTS, asksOf, layPrint, printCost } from '../src/sim/build/blueprints';

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
  // (the progression plan, approved 2026-10-25: stone takes nails too, and the armoured tier is looted plate and forged bars)
  assert.deepEqual(costOf('wall', 2), { stone: 30, nails: 6 });
  assert.deepEqual(costOf('wall', 3), { sheet_metal: 4, nails: 24 });
  assert.deepEqual(costOf('wall', 4), { steel_plate: 2, iron_bar: 6, nails: 30 });
  assert.deepEqual(costOf('wall_half', 1), { planks: 5, nails: 6 });
  assert.deepEqual(costOf('foundation', 0), { planks: 4, log: 2 });
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => hpOf('wall', t as Tier)), [60, 500, 1000, 2000, 4000]);
  // (plan v2: 22 pieces, less the ladder that is set down, and 12 fittings: the doors, the windows' and the gates; and
  // the progression plan's two armoured doors)
  const fitting = (k: string) => PIECES[k].role === 'fit' || k.startsWith('gate_');
  assert.equal(Object.keys(PIECES).filter((k) => PIECES[k].role !== 'deploy' && PIECES[k].role !== 'lean' && !fitting(k)).length, 21);
  assert.equal(Object.keys(PIECES).filter(fitting).length, 14);
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

ok('rot: a frame is gone in 2 h, wood 12 h, stone 24 h, metal 36 h, armoured 48 h; with no claim, after 10 minutes of grace', () => {
  for (const [t, h] of [[0, 2], [1, 12], [2, 24], [3, 36], [4, 48]] as const) {
    const bs = new Bases(flat), b = start(bs);
    // (straight to its tier: the workbench the top two are nailed up near is not what is asked here)
    const p = b.pieces.get(1)!;
    p.t = t;
    p.hp = hpOf(p.k, t);
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

ok('the metal fittings need a workbench II near, the armoured ones a III; the wooden ones none', () => {
  const { bs, b } = hut();
  const s = spots(b, 'door_metal')[0];
  assert.match(String(bs.lay({ b: b.id, k: 'door_metal', ...s }, ME, 0)), /needs a level II workbench/);
  assert.ok(typeof bs.lay({ b: b.id, k: 'bars_wood', ...spots(b, 'bars_wood')[0] }, ME, 0) !== 'string');
  const h = hut(true), bench = [...h.b.pieces.values()].find((p) => p.k === 'workbench')!;
  // (a level I bench is not enough; brought up a level at a time, for its own cost, it is)
  assert.match(String(h.bs.lay({ b: h.b.id, k: 'door_metal', ...spots(h.b, 'door_metal')[0] }, ME, 0)), /needs a level II workbench/);
  assert.equal(h.bs.canUpgrade(h.b.id, bench.id, 3), 'A level at a time');
  assert.deepEqual(costOf('workbench', 2), { iron_bar: 10, nails: 40, hardware: 2 });
  assert.ok(h.bs.upgrade(h.b.id, bench.id, 2));
  assert.equal(benchLevel(bench), 2);
  assert.ok(typeof h.bs.lay({ b: h.b.id, k: 'door_metal', ...spots(h.b, 'door_metal')[0] }, ME, 0) !== 'string');
  assert.match(String(h.bs.canUpgrade(h.b.id, 2, 4)), /level III workbench/, 'a wall up to armoured');
  assert.deepEqual(costOf('door_metal', 3), { sheet_metal: 4, nails: 20, hardware: 1 });
  assert.deepEqual([hpOf('door_wood', 1), hpOf('door_metal', 3), hpOf('garage_door', 3), hpOf('door_armoured', 4)], [250, 500, 1000, 1000]);
});

ok('a piece is mended for a share of its cost, nails and all, by the health it lost; not within half a minute of a blow', () => {
  const { bs, b } = hut(), p = [...b.pieces.values()].find((q) => q.k === 'wall')!;
  bs.upgrade(b.id, p.id, 1);
  assert.equal(bs.canRepair(b.id, p.id, 0, 1e9), 'It is whole');
  p.hp = 250;
  assert.deepEqual(repairOf(p), { planks: 3, nails: 3 }, 'half its health: a quarter of what it cost');
  assert.equal(bs.canRepair(b.id, p.id, 1e9 - 10_000, 1e9), 'It was struck: in a while');
  assert.equal(bs.canRepair(b.id, p.id, 1e9 - MEND.after - 1, 1e9), null);
  bs.repair(b.id, p.id);
  assert.equal(p.hp, 500);
  // (and turned about within ten minutes of being laid, not after)
  const r = p.r;
  assert.equal(bs.canTurn(b.id, p.id, p.at + 1000), null);
  bs.turn(b.id, p.id);
  assert.equal(p.r, (r + 6) % 12);
  assert.equal(bs.canTurn(b.id, p.id, p.at + MEND.turn + 1), 'It has stood too long to turn');
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

console.log('Building: locks');
ok('a lock fits what swings shut, a box and the claim; it lets in whoever knows its code or carries its key', () => {
  assert.deepEqual(['door_wood', 'garage_door', 'hatch', 'gate_stone', 'box_small', 'claim', 'shutters', 'wall', 'workbench'].map(lockable), [true, true, true, true, true, true, false, false, false]);
  const code = { k: 'code' as const, on: true, who: ['me'], code: '1234' };
  assert.ok(mayPass(code, 'me') && !mayPass(code, 'you') && mayPass({ ...code, on: false }, 'you'));
  const key = { k: 'key' as const, on: true, who: ['me'], key: 77 };
  assert.ok(!mayPass(key, 'you') && mayPass(key, 'you', [77]) && !mayPass(key, 'you', [78]));
});

ok("a lock's code and its keys' number are kept in the save and never told to a game", () => {
  const { bs, b } = hut();
  const d = at(bs, b, 'door_wood', 0, 1.2, 1.5);
  d.lock = { k: 'code', on: true, who: ['me', 'you'], code: '0420' };
  const told = JSON.stringify(said(b));
  assert.ok(told.includes('"you"') && !told.includes('0420'), told);
  const again = heard(JSON.parse(JSON.stringify(bs.keep()))[0])!;
  assert.deepEqual(again.pieces.get(d.id)?.lock, { k: 'code', on: true, who: ['me', 'you'], code: '0420' });
  d.lock = { k: 'key', on: false, who: ['me'], key: 991 };
  assert.ok(!JSON.stringify(said(b)).includes('991'));
  assert.equal(heard(JSON.parse(JSON.stringify(bs.keep()))[0])!.pieces.get(d.id)?.lock?.key, 991);
});

console.log('Building: blueprints');
ok('every blueprint is laid whole by the rules; short of planks one lays what it can in order, and laid again finishes', () => {
  for (const p of PRINTS) {
    const bs = new Bases(flat), r = layPrint(bs, p.id, { x: 0, z: 0, yaw: 0.4 }, ME, 0, 'Me', () => true);
    assert.equal(r.laid.length, asksOf(p.id).length, `${p.id}: ${r.why}`);
    console.log(`      ${p.name}: ${r.laid.length} pieces, ${Object.entries(printCost(p.id)).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  }
  const bs = new Bases(flat);
  let planks = 20;
  const pay = (c: Record<string, number>) => {
    if ((c.planks ?? 0) > planks) return false;
    planks -= c.planks ?? 0;
    return true;
  };
  const first = layPrint(bs, 'bp:hut', { x: 0, z: 0, yaw: 0 }, ME, 0, 'Me', pay);
  assert.ok(first.base && first.laid.length === 5 && /Short/.test(first.why ?? ''), `${first.laid.length}: ${first.why}`);
  planks = 100;
  const again = layPrint(bs, 'bp:hut', { b: first.base!.id, x: 0, z: 0, yaw: 0 }, ME, 0, 'Me', pay);
  assert.deepEqual(again.laid.map((p) => p.k), ['door_wood', 'roof']);
  assert.equal(first.base!.pieces.size, asksOf('bp:hut').length);
});

console.log('Building: where on the map');
ok('nothing is built within 60 m of a named place or a building, nor inside the Zona; and it says which', () => {
  // (out in the west, where the map is open: nothing of the world's own near)
  const [x, z] = [-1950, 200], kind = Object.keys(BUILDING_FOOTPRINT)[0] as keyof typeof BUILDING_FOOTPRINT, half = BUILDING_FOOTPRINT[kind]![0] / 2;
  assert.equal(noBuilding(x, z, [], []), null, 'the open ground itself');
  assert.equal(noBuilding(x, z, [{ x: x + 95, z, radius: 40, name: 'Kamenka' }], []), 'Too near Kamenka');
  assert.equal(noBuilding(x, z, [{ x: x + 105, z, radius: 40, name: 'Kamenka' }], []), null, '65 m past its reach');
  assert.equal(noBuilding(x, z, [], [{ type: kind, x: x + half + 55, z, rot: 0 }]), 'Too near a building');
  assert.equal(noBuilding(x, z, [], [{ type: kind, x: x + half + 65, z, rot: 0 }]), null, '65 m past its walls');
  assert.ok(inPlay(0, 0) && noBuilding(0, 0, [], []) === 'Inside the Zona', 'in the Zona');
  // (and not across the west's ridge, whose wall nobody is let past but at its pass)
  let ridge: [number, number] | null = null;
  for (let rz = -300; rz < 300 && !ridge; rz += 50) for (let rx = PLAN.ridge.crest - 40; rx <= PLAN.ridge.crest + 40 && !ridge; rx += 0.5) if (onRidgeWall(rx, rz)) ridge = [rx, rz];
  assert.ok(ridge, 'no ridge wall found');
  assert.equal(noBuilding(ridge![0] + 8, ridge![1], [], []), 'Not on the ridge');
});

console.log('Building: solid (what stops a round, a step and a body: src/sim/build/solid.ts)');
/** the two-storey house from its blueprint on flat ground, its pieces by kind, and its solids */
const house = () => {
  const bs = new Bases(flat), r = layPrint(bs, 'bp:house', { x: 0, z: 0, yaw: 0.4 }, ME, 0, 'Me', () => true);
  assert.ok(r.base && r.laid.length === asksOf('bp:house').length, `the house: ${r.laid.length} ${r.why}`);
  const b = r.base!, all = [...b.pieces.values()], piece = (k: string, x: number, z: number, y?: number) => all.find((p) => p.k === k && Math.abs(p.x - x) < 0.1 && Math.abs(p.z - z) < 0.1 && (y === undefined || Math.abs(p.y - y) < 0.6))!;
  /** a point of a piece's own frame in the world */
  const of = (p: Piece, x: number, y: number, z: number) => toWorld(b, ...inBase(p, [x, y, z]));
  return { bs, b, piece, of, w: (x: number, y: number, z: number) => toWorld(b, x, y, z), solid: new BaseSolids(() => bs.bases.values()) };
};

ok('a round stops at a wall, a floor and a shut door; it goes through a window, an open door and the gaps in bars', () => {
  const { bs, b, piece, of, w, solid } = house();
  assert.ok(!solid.clear(w(0, 1.2, -4), w(0, 1.2, 0)), 'through a wall');
  assert.ok(!solid.clear(w(0, STOREY + 1.5, 0), w(0, 1.5, 0)), 'down through a floor');
  const door = piece('door_wood', 0, 4.5);
  assert.ok(!solid.clear(w(0, 1.2, 7), w(0, 1.2, 3)), 'through the shut door');
  door.open = true;
  assert.ok(solid.clear(w(0, 1.2, 7), w(0, 1.2, 3)), 'not through the open door');
  const win = piece('window', 4.5, 0, STOREY);
  assert.ok(solid.clear(of(win, 0, 1.6, 2), of(win, 0, 1.6, -1.2)), 'not through the window upstairs');
  assert.ok(!solid.clear(of(win, 0, 0.6, 2), of(win, 0, 0.6, -1.2)), 'through the wall under the window');
  const bars = bs.lay({ b: b.id, k: 'bars_wood', ...spots(b, 'bars_wood').find((s) => Math.abs(s.x - 4.5) < 0.1)! }, ME, 0);
  assert.ok(typeof bars !== 'string', `no bars: ${bars}`);
  assert.ok(solid.clear(of(win, -0.4, 1.6, 2), of(win, -0.4, 1.6, -1.2)), 'not between two bars');
  assert.ok(!solid.clear(of(win, -0.3, 1.6, 2), of(win, -0.3, 1.6, -1.2)), 'through a bar');
});

ok('what lies on a base lies on its floor; a step through its wall, floor, bars or shut door is refused, and out of one let go', () => {
  const { bs, b, piece, of, w, solid } = house();
  assert.ok(Math.abs(solid.top(...w(0, STOREY + 2, 0)) - (b.oy + STOREY)) < 0.01, `upstairs: ${solid.top(...w(0, STOREY + 2, 0))} for ${b.oy + STOREY}`);
  assert.ok(Math.abs(solid.top(...w(0, 1, 0)) - b.oy) < 0.01, 'downstairs: the foundation\'s top');
  assert.equal(solid.top(...w(0, 1, -6)), -Infinity, 'nothing outside');
  assert.ok(solid.crosses(w(0, 0.45, -2.2), w(0, 0.45, -0.8)), 'in through a wall');
  assert.ok(!solid.crosses(w(0, 0.45, -0.6), w(0, 0.45, 0.6)), 'across the floor inside');
  assert.ok(!solid.crosses(w(0, 0.45, -1.5), w(0, 0.45, -2.5)), 'out of a wall one is in');
  assert.ok(solid.crosses(w(0, 2.4, 0), w(0, STOREY + 0.45, 0)), 'up through a floor');
  assert.ok(solid.crosses(w(0, 0.45, 6), w(0, 0.45, 3.6)), 'through the shut door');
  piece('door_wood', 0, 4.5).open = true;
  assert.ok(!solid.crosses(w(0, 0.45, 6), w(0, 0.45, 3.6)), 'not through the open door');
  const win = piece('window', 4.5, 0, STOREY);
  bs.lay({ b: b.id, k: 'bars_wood', ...spots(b, 'bars_wood').find((s) => Math.abs(s.x - 4.5) < 0.1)! }, ME, 0);
  assert.ok(solid.crosses(of(win, -0.4, 1.6, 1), of(win, -0.4, 1.6, -1)), 'between two bars, a body\'s middle');
});

ok('somebody in its rooms is shut in it; on its roof or outside, not; in a wall is in a piece', () => {
  const { b, w, solid } = house();
  assert.equal(solid.roomOf(...w(0, 0, 0)), b, 'downstairs');
  assert.equal(solid.roomOf(...w(0, STOREY, 0)), b, 'upstairs, under the roof');
  assert.equal(solid.roomOf(...w(0, 2 * STOREY + 1.6, 0)), null, 'on the roof');
  assert.equal(solid.roomOf(...w(0, -0.3, -5)), null, 'outside');
  assert.ok(solid.within(...w(-1.5, 1, 0)) && !solid.within(...w(0, 1, 0)), 'in a wall, and not in the room');
  assert.ok(solid.within2(b, ...([w(1.5, 0, 1.5)[0], w(1.5, 0, 1.5)[2]] as [number, number])) && !solid.within2(b, w(0, 0, -6)[0], w(0, 0, -6)[2]), 'its outline');
});

ok('a room shut all round in stone keeps its light in: its door open, a wall of wood or a window unshuttered, and it does not', () => {
  const stone = () => {
    const h = house();
    for (const p of h.b.pieces.values()) p.t = Math.max(p.t, 2) as Tier;
    for (const s of spots(h.b, 'shutters')) assert.ok(typeof h.bs.lay({ b: h.b.id, k: 'shutters', ...s }, ME, 0) !== 'string', 'no shutters');
    return h;
  };
  const { b, w, piece } = stone(), inside = w(0, 0.1, 0);
  const room = shutRoom(b, ...inside);
  assert.ok(room && room.cells.size === 8, `the whole house, both storeys up its stairs: ${room?.cells.size}`);
  assert.ok(inRoom(room!, b, ...w(3, 3.1, 0)) && !inRoom(room!, b, ...w(0, 0.1, -4)), 'upstairs is in it, outside is not');
  piece('door_wood', 0, 4.5).open = true;
  assert.equal(shutRoom(b, ...inside), null, 'its door open');
  const h2 = stone();
  h2.piece('wall', -1.5, 0, 0).t = 1;
  assert.equal(shutRoom(h2.b, ...h2.w(0, 0.1, 0)), null, 'a wall of wood');
  const h3 = stone();
  [...h3.b.pieces.values()].find((p) => p.k === 'shutters')!.open = true;
  assert.equal(shutRoom(h3.b, ...h3.w(0, 0.1, 0)), null, 'a window open');
});

ok('a thing set down is turned any way, to a degree, and kept so; a box in quarter turns, squared to its base', () => {
  const bs = new Bases(flat), b = start(bs);
  const at = deployAt(b, 'workbench', { x: 0, y: 0, z: 0 }, 1.37)!;
  assert.ok(Math.abs(at.r - 41 / 30) < 1e-9, `a workbench turned 41.1 degrees is turned 41: ${at.r * 30}`);
  const r = bs.lay({ b: b.id, k: 'workbench', ...at }, ME, 0);
  assert.ok(typeof r !== 'string', `not laid: ${r}`);
  assert.equal(heardPiece(saidPiece(r.piece))!.r, r.piece.r, 'its turn told and kept to the degree');
  assert.equal(deployAt(b, 'box_small', { x: 1, y: 0, z: 1 }, 1.4)!.r, 0, 'a box a little turned: square');
  assert.equal(deployAt(b, 'box_small', { x: 1, y: 0, z: 1 }, 4.6)!.r, 6, 'a box near half round: half round');
  // (a piece of a building keeps whole steps)
  const wall = at && spots(b, 'wall')[0];
  assert.ok(Number.isInteger(wall.r), 'a wall in whole steps');
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
  // (out of the Zona and 60 m off every named place and building: the west, as the map is now)
  for (let x = -2400; x < 2400 && !site; x += 37) for (let z = -1500; z < 1500 && !site; z += 41) {
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
      // (the bases about where they come in are told in the welcome itself: taken as told)
      for (const b of this.of('welcome')[0].bases ?? []) this.got.push({ t: 'base', b });
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
    // the server's own word on where nothing is built: in the Zona, and by a named place (as the ghost says it)
    await a.go(0, 0);
    a.send({ t: 'blay', k: 'foundation', x: 0, y: 0, z: 0, r: 0, yaw: 0, u: plan.uid });
    assert.ok(await a.until('tell', (m) => m.text === 'Inside the Zona'), `laid in the Zona: ${JSON.stringify(a.of('tell').slice(-1))}`);
    const town = data.places.find((p) => p.name && !inPlay(p.x, p.z) && noBuilding(p.x + p.radius + 30, p.z, [], [], [], wet) === null)!;
    await a.go(town.x + town.radius + 30, town.z);
    a.send({ t: 'blay', k: 'foundation', x: town.x + town.radius + 30, y: 0, z: town.z, r: 0, yaw: 0, u: plan.uid });
    assert.ok(await a.until('tell', (m) => m.text === `Too near ${town.name}`), `laid by ${town.name}: ${JSON.stringify(a.of('tell').slice(-1))}`);
    console.log(`  ok  the server lays nothing in the Zona ("Inside the Zona") nor 30 m past ${town.name} ("Too near ${town.name}")`);
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
    // (a place of its own, 60 m and more east of the first, where a foundation may go)
    let claimAt: [number, number] | null = null;
    for (let r = 60; r < 400 && !claimAt; r += 17) for (let q = -1.2; q < 1.2 && !claimAt; q += 0.3) {
      const x = sx + Math.cos(q) * r, z = sz + Math.sin(q) * r;
      if (x > sx + 30 && typeof new Bases(land).lay({ k: 'foundation', x, y: 0, z, r: 0, yaw: 0 }, ME, 0) !== 'string') claimAt = [x, z];
    }
    assert.ok(claimAt, 'no place for the claim');
    const [cx, cz] = claimAt!;
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
    assert.ok(toldD, `no base for the door at ${dx.toFixed(0)}, ${dz.toFixed(0)}: ${JSON.stringify(me.of('tell').slice(-2))}`);
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
    // (set down there, not walked: a step from the ground through the foundation's side is refused, server/solid.ts)
    const stand = async (who: Player, x: number, z: number) => {
      const had = who.of('put').length;
      who.send({ t: 'chat', text: `/tp ${(D.ox + x).toFixed(3)} ${D.oy.toFixed(3)} ${(D.oz + z).toFixed(3)}` });
      for (let k = 0; k < 160 && who.of('put').length === had; k++) await sleep(25);
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

    // ---- locks: a code lock on the door; a stranger is shut out and shocked by a wrong code, let in by the right one
    const lockIt = await me.give('code_lock');
    const sinceL = me.got.length;
    me.send({ t: 'block', b: D.id, p: P, u: lockIt.uid, code: '0420' });
    const locked = await me.until('bpc', (m) => m.b === D.id && m.p[0] === P && !!(m.p[9] as { l?: unknown } | undefined)?.l, 3000, sinceL);
    assert.ok(locked, `no lock: ${JSON.stringify(me.of('tell').slice(-2))}`);
    assert.ok(!JSON.stringify(locked).includes('0420'), 'the code was told');
    await stand(them, 2.2, 3.4);
    // (a door swung a moment ago is not swung again at once: DOOR.again)
    await sleep(500);
    const sinceT = them.got.length;
    them.send({ t: 'bdoor', b: D.id, p: P, open: true });
    assert.ok(await them.until('tell', (m) => /locked/.test(m.text), 3000, sinceT), `a stranger opened a locked door: ${JSON.stringify(them.got.slice(sinceT).filter((m) => m.t === 'tell' || m.t === 'bdoor'))}`);
    them.send({ t: 'bcode', b: D.id, p: P, code: '1111' });
    assert.ok(await them.until('dmg', (m) => m.w === 'shock' && m.amount === 10, 3000, sinceT), 'a wrong code did not shock');
    them.send({ t: 'bcode', b: D.id, p: P, code: '0420' });
    assert.ok(await them.until('tell', (m) => /code is right/.test(m.text), 3000, sinceT), 'the right code was not taken');
    await sleep(500);
    them.send({ t: 'bdoor', b: D.id, p: P, open: true });
    assert.ok(await them.until('bdoor', (m) => m.b === D.id && m.p === P && m.o === 1, 3000, sinceT), 'the right code did not let them in');
    // (three wrong codes from somebody else again: shut out a minute)
    me.send({ t: 'bcode', b: D.id, p: P, code: '0420', set: true });
    await sleep(400);
    for (const c of ['1', '2', '3']) them.send({ t: 'bcode', b: D.id, p: P, code: c.repeat(4) });
    assert.ok(await them.until('tell', (m) => /take none for 60 s/.test(m.text), 3000, sinceT), 'three wrong codes did not shut them out');
    console.log('  ok  a code lock: a stranger is shut out, shocked by a wrong code, let in by the right one; three wrong shut them out a minute');
    // a key lock on a box: its key given to whoever fitted it; the box opens for them and not for the stranger
    await me.give('planks', 12);
    await me.give('nails', 8);
    const bx = deployAt(D, 'box_small', { x: -0.5, y: 0, z: -0.5 })!;
    me.send({ t: 'blay', k: 'box_small', b: D.id, x: bx.x, y: bx.y, z: bx.z, r: 0, u: plan3.uid });
    const boxPc = await me.until('bpc', (m) => m.b === D.id && PIECES[PIECE_IDS[m.p[1]]]?.store !== undefined, 3000, sinceL);
    assert.ok(boxPc, `no box: ${JSON.stringify(me.of('tell').slice(-2))}`);
    await stand(me, -0.5, 1.2);
    await stand(them, 0.5, 0.8);
    const keyLock = await me.give('key_lock');
    const sinceK = me.got.length;
    me.send({ t: 'block', b: D.id, p: boxPc!.p[0], u: keyLock.uid });
    const keyKit = await me.until('kit', (m) => m.items.some((i) => i.id === 'key'), 3000, sinceK);
    assert.ok(keyKit && keyKit.items[0].key! > 0, `no key: ${JSON.stringify(me.of('tell').slice(-2))}`);
    me.pockets.push(...keyKit!.items);
    me.me();
    const boxCid = `bbox:${D.id}:${boxPc!.p[0]}`;
    them.send({ t: 'copen', cid: boxCid });
    assert.ok(await them.until('tell', (m) => /locked/.test(m.text), 3000, sinceT), 'the stranger opened a locked box');
    me.send({ t: 'copen', cid: boxCid });
    assert.ok(await me.until('cdata', (m) => m.cid === boxCid, 3000, sinceK), 'the box did not open for its owner');
    console.log('  ok  a key lock on a box: its key given to whoever fitted it; the box opens for them and not for a stranger');

    // ---- a sleeping bag: laid only in a base whose claim one is on; woken at after a death, and not again so soon
    const bag = await me.give('sleeping_bag');
    // (a foundation of its own beside the hut: the hut's floor has its box and its door's swing)
    await me.give('planks', 4);
    await me.give('log', 2);
    const sinceB = me.got.length;
    const gIn = new Bases(land).groundIn(D);
    const fs = [[-3, 0], [0, -3], [3, 0], [0, 3]].map(([x, z]) => nearestSpot(spots(D, 'foundation'), 'foundation', { x, y: 0, z }, 1)).find((sp) => sp && !blocked(D, 'foundation', sp, gIn))!;
    me.send({ t: 'blay', k: 'foundation', b: D.id, ...fs, u: plan3.uid });
    const f2 = await me.until('bpc', (m) => m.b === D.id && PIECE_IDS[m.p[1]] === 'foundation', 3000, sinceB);
    assert.ok(f2, `no second foundation: ${JSON.stringify(me.of('tell').slice(-2))}`);
    const f2p = heardPiece(f2!.p)!;
    D.pieces.set(f2p.id, f2p);
    const bs1 = deployAt(D, 'bedroll', { x: fs.x, y: 0, z: fs.z })!;
    me.send({ t: 'blay', k: 'bedroll', b: D.id, x: bs1.x, y: bs1.y, z: bs1.z, r: 0, u: plan3.uid });
    assert.ok(await me.until('tell', (m) => /claim you are on/.test(m.text), 3000, sinceB), 'a bed laid with no claim');
    await me.give('log', 1);
    await me.give('planks', 10);
    await me.give('nails', 10);
    const cl2 = deployAt(D, 'claim', { x: 0.5, y: 0, z: 0.5 })!;
    me.send({ t: 'blay', k: 'claim', b: D.id, x: cl2.x, y: cl2.y, z: cl2.z, r: 0, u: plan3.uid });
    assert.ok(await me.until('bclaim', (m) => m.b === D.id && !!m.c, 3000, sinceB), `no claim for the bed: ${JSON.stringify(me.of('tell').slice(-2))}`);
    const bs2 = bs1;
    me.send({ t: 'blay', k: 'bedroll', b: D.id, x: bs2.x, y: bs2.y, z: bs2.z, r: 0, u: plan3.uid });
    const bagPc = await me.until('bpc', (m) => m.b === D.id && PIECE_IDS[m.p[1]] === 'bedroll', 3000, sinceB);
    assert.ok(bagPc, `no sleeping bag: ${JSON.stringify(me.of('tell').slice(-2))}`);
    assert.ok(me.of('spent').some((m) => m.items.some(([id]) => id === 'sleeping_bag')), 'the bag was not spent');
    void bag;
    me.send({ t: 'mybeds' });
    const beds = await me.until('beds', (m) => m.list.length > 0, 3000, sinceB);
    assert.ok(beds && beds.list[0][2] === 'bedroll' && beds.list[0][5] === 0, `beds: ${JSON.stringify(beds)}`);
    // (dead by its own game's word, and back at the bag, on it)
    me.send({ t: 's', p: [me.pos[0], me.pos[1], me.pos[2], 0, 0, F_DEAD], w: null, m: [] });
    await sleep(200);
    me.send({ t: 'respawn', bed: { b: D.id, p: bagPc!.p[0] } });
    const woke = await me.until('spawn', () => true, 3000, sinceB);
    assert.ok(woke && Math.hypot(woke.x - (D.ox + bagPc!.p[3] / 100), woke.z - (D.oz + bagPc!.p[5] / 100)) < 0.5 && Math.abs((woke.y ?? 0) - (D.oy + 0.15)) < 0.05, `woke at ${JSON.stringify(woke)}`);
    me.send({ t: 's', p: [woke!.x, woke!.y!, woke!.z, 0, 0, F_DEAD], w: null, m: [] });
    await sleep(200);
    me.send({ t: 'respawn', bed: { b: D.id, p: bagPc!.p[0] } });
    assert.ok(await me.until('tell', (m) => /not ready/.test(m.text), 3000, sinceB), 'woken at the bag again at once');
    me.send({ t: 'respawn' });
    assert.ok(await me.until('spawn', (m) => m !== woke, 3000, sinceB), 'not back at the edge');
    console.log('  ok  a sleeping bag goes only in a base whose claim one is on; its owner wakes on it after a death, and not again for ten minutes');

    // ---- a blueprint: the hut laid whole by one word, out of the pockets
    for (const [id, n] of [['planks', 20], ['planks', 20], ['log', 2], ['nails', 10]] as const) await me.give(id, n);
    let hutAt: [number, number] | null = null;
    for (let r = 0; r < 600 && !hutAt; r += 23) for (let q = 0; q < 6.28 && !hutAt; q += 0.7) {
      const x = sx - 150 + Math.cos(q) * r, z = sz + Math.sin(q) * r;
      if (typeof new Bases(land).lay({ k: 'foundation', x, y: 0, z, r: 0, yaw: 0 }, ME, 0) !== 'string') hutAt = [x, z];
    }
    assert.ok(hutAt, 'no place for the hut');
    await me.go(hutAt![0], hutAt![1] + 6);
    const sinceP = me.got.length;
    me.send({ t: 'bprint', id: 'bp:hut', x: hutAt![0], z: hutAt![1], yaw: 0, u: plan3.uid });
    const hutBase = await me.until('base', (m) => Math.hypot(m.b[1] - hutAt![0], m.b[3] - hutAt![1]) < 1, 5000, sinceP);
    assert.ok(hutBase && hutBase.b[7].length === 7, `the hut: ${JSON.stringify(hutBase?.b[7].length)} ${JSON.stringify(me.of('tell').slice(-2))}`);
    assert.ok(me.of('spent').slice(-12).some((m) => m.items.some(([id]) => id === 'log')), 'the hut was not paid for');
    console.log('  ok  a blueprint: the 1x1 hut laid whole, frames and its door, paid for out of the pockets');

    // ---- solid: a round through a wall refused, a step through one put back, nobody back inside one, and a body and
    // a thing on a second storey's floor (the owner via the navigator, 2026-10-24: "bases need full collision, also
    // should be communicated to server so it cant be shot through or noclipped into somehow via relogging etc...")
    const Hb = heard(hutBase!.b)!;
    const hw = (x: number, y: number, z: number) => toWorld(Hb, x, y, z);
    /** set down at a place (an admin's /tp, a height and all), and saying so */
    const goAt = async (who: Player, [x, y, z]: [number, number, number]) => {
      const had = who.of('put').length;
      who.send({ t: 'chat', text: `/tp ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}` });
      for (let k = 0; k < 160 && who.of('put').length === had; k++) await sleep(25);
      who.pos = [x, y, z];
      who.hold(who.held);
      await sleep(80);
    };
    const meId = me.of('welcome')[0].you;
    const gun = await them.give('m9');
    them.held = gun.id;
    await goAt(me, hw(0, 0, -0.6));
    await goAt(them, [hw(0, 0, -3)[0], data.groundAt(hw(0, 0, -3)[0], hw(0, 0, -3)[2]), hw(0, 0, -3)[2]]);
    const sinceS = them.got.length;
    them.send({ t: 'hit', to: meId, zone: 'torso', w: 'm9', dist: 2.4, sup: false, bonus: 0 });
    await sleep(700);
    assert.ok(!them.of('hitok').length && !them.got.slice(sinceS).some((m) => m.t === 'hitok'), 'a round through the wall struck');
    assert.match(logged, /hit Builder through a base: not let through/);
    // (and through the doorway: shut, refused; open, struck)
    await goAt(them, [hw(0, 0, 3.2)[0], data.groundAt(hw(0, 0, 3.2)[0], hw(0, 0, 3.2)[2]), hw(0, 0, 3.2)[2]]);
    await goAt(me, hw(0, 0, 0.3));
    await sleep(300);
    them.send({ t: 'hit', to: meId, zone: 'torso', w: 'm9', dist: 3, sup: false, bonus: 0 });
    await sleep(600);
    assert.ok(!them.got.slice(sinceS).some((m) => m.t === 'hitok'), 'a round through the shut door struck');
    const hutDoor = [...Hb.pieces.values()].find((p) => p.k === 'door_wood')!;
    me.send({ t: 'bdoor', b: Hb.id, p: hutDoor.id, open: true });
    assert.ok(await me.until('bdoor', (m) => m.b === Hb.id && m.o === 1, 3000), 'the hut\'s door did not open');
    await sleep(300);
    them.send({ t: 'hit', to: meId, zone: 'torso', w: 'm9', dist: 3, sup: false, bonus: 0 });
    assert.ok(await them.until('hitok', () => true, 3000, sinceS), 'a round through the open door did not strike');
    console.log('  ok  a round through a wall or a shut door is refused on the server; through the open door it strikes');
    // a step through a wall: kept outside, and their game put back there
    me.send({ t: 'bdoor', b: Hb.id, p: hutDoor.id, open: false });
    await me.until('bdoor', (m) => m.b === Hb.id && m.o === 0, 3000);
    const outside = hw(0, 0, -2.2);
    await goAt(them, [outside[0], data.groundAt(outside[0], outside[2]), outside[2]]);
    const sinceW = them.got.length, from = them.pos;
    const inside = hw(0, 0, -0.8);
    them.send({ t: 's', p: [inside[0], inside[1], inside[2], 0, 0, 0], w: gun.id, m: [] });
    const putBack = await them.until('put', () => true, 2000, sinceW);
    assert.ok(putBack && Math.hypot(putBack.x - from[0], putBack.z - from[2]) < 0.05, `not put back from the wall: ${JSON.stringify(putBack)}`);
    console.log('  ok  a step through a wall is refused, and the game put back where it was');
    // back in the world inside a wall: set down clear of it
    const inWall = hw(-1.5, 0, 0);
    await goAt(me, inWall);
    me.ws.close();
    await sleep(600);
    const me2 = new Player('Builder');
    await me2.join();
    const sp1 = me2.of('welcome')[0].spawn;
    const [lx1, , lz1] = toLocal(Hb, sp1.x, sp1.y ?? 0, sp1.z);
    assert.ok(Math.abs(lx1 + 1.5) > 0.3 || Math.abs(lz1) > 1.7, `back in the wall at ${lx1.toFixed(2)}, ${lz1.toFixed(2)}`);
    assert.match(logged, /came back inside a piece of a base/);
    // and shut in somebody else's: out of it
    await goAt(them, hw(0.4, 0, -0.4));
    them.ws.close();
    await sleep(600);
    const them2 = new Player('Stranger');
    await them2.join();
    const sp2 = them2.of('welcome')[0].spawn;
    assert.ok(Math.hypot(sp2.x - Hb.ox, sp2.z - Hb.oz) > 4, `the stranger woke ${Math.hypot(sp2.x - Hb.ox, sp2.z - Hb.oz).toFixed(1)} m from the hut's middle`);
    assert.match(logged, /came back shut in base \d+, not theirs/);
    console.log(`  ok  back in the world inside a wall: set down clear of it (${Math.hypot(lx1 + 1.5, 0).toFixed(1)} m along); shut in somebody else's base: out of it (${Math.hypot(sp2.x - Hb.ox, sp2.z - Hb.oz).toFixed(1)} m from its middle)`);
    // a watchtower: a body dead two metres over its floor lies on the floor; a box taken down there spills onto it
    await me2.give('suitcase');
    const cost = printCost('bp:tower');
    for (const [id, n] of Object.entries(cost)) for (let left = n; left > 0; left -= 20) await me2.give(id, Math.min(20, left));
    await me2.give('planks', 20);
    await me2.give('nails', 20);
    const plan5 = await me2.give('building_plan');
    let towerAt: [number, number] | null = null;
    for (let r = 0; r < 600 && !towerAt; r += 23) for (let q = 0; q < 6.28 && !towerAt; q += 0.7) {
      const x = sx + 150 + Math.cos(q) * r, z = sz + Math.sin(q) * r;
      if ([D, B, Hb].some((o) => Math.hypot(o.ox - x, o.oz - z) < 80)) continue;
      if (typeof new Bases(land).lay({ k: 'foundation', x, y: 0, z, r: 0, yaw: 0 }, ME, 0) !== 'string') towerAt = [x, z];
    }
    assert.ok(towerAt, 'no place for the tower');
    await me2.go(towerAt![0], towerAt![1] + 6);
    const sinceT2 = me2.got.length;
    me2.send({ t: 'bprint', id: 'bp:tower', x: towerAt![0], z: towerAt![1], yaw: 0, u: plan5.uid });
    const towerB = await me2.until('base', (m) => Math.hypot(m.b[1] - towerAt![0], m.b[3] - towerAt![1]) < 1, 5000, sinceT2);
    assert.ok(towerB && towerB.b[7].length === asksOf('bp:tower').length, `the tower: ${towerB?.b[7].length} ${JSON.stringify(me2.of('tell').slice(-2))}`);
    const T = heard(towerB!.b)!, floorY = T.oy + STOREY;
    // (a claim set down on its floor by the stranger, a plank in its store, taken down: the plank on the floor. A box with
    // anything in it is not taken down; a claim's store spills, as it does when its base rots: server/claims.ts)
    const plan6 = await them2.give('building_plan'), ham6 = await them2.give('hammer');
    await them2.give('log', 1);
    await them2.give('planks', 20);
    await them2.give('nails', 10);
    await goAt(them2, toWorld(T, -0.6, STOREY, -0.6));
    const tc = deployAt(T, 'claim', { x: 0.6, y: STOREY, z: 0.6 })!;
    assert.ok(tc, "no room for a claim on the tower's floor");
    const sinceL2 = them2.got.length;
    them2.send({ t: 'blay', k: 'claim', b: T.id, x: tc.x, y: tc.y, z: tc.z, r: 0, u: plan6.uid });
    const tcl = await them2.until('bpc', (m) => m.b === T.id && PIECE_IDS[m.p[1]] === 'claim', 3000, sinceL2);
    assert.ok(tcl, `no claim on the floor: ${JSON.stringify(them2.of('tell').slice(-2))}`);
    const tcid = `claim:${T.id}`;
    them2.send({ t: 'copen', cid: tcid });
    assert.ok(await them2.until('cdata', (m) => m.cid === tcid, 3000, sinceL2), 'its store did not open');
    const plank = them2.pockets.find((it) => it.id === 'planks')!;
    them2.send({ t: 'cset', cid: tcid, items: [{ ...plank, qty: 2, x: 0, y: 0, rot: false }] });
    await sleep(300);
    them2.hold('hammer');
    them2.send({ t: 'bdel', b: T.id, p: tcl!.p[0], u: ham6.uid });
    const spilt = await them2.until('loot+', (m) => m.l.item.id === 'planks', 3000, sinceL2);
    assert.ok(spilt && Math.abs(spilt.l.y - floorY) < 0.1, `the store spilled at ${spilt?.l.y?.toFixed(2)} (the floor ${floorY.toFixed(2)}, the ground ${data.groundAt(spilt?.l.x ?? T.ox, spilt?.l.z ?? T.oz).toFixed(2)}): ${JSON.stringify(them2.got.slice(sinceL2).filter((m) => ['tell', 'bout', 'loot+'].includes(m.t)).slice(-4))}`);
    // (dead in the air over the floor: the body falls to the floor, not the ground)
    // (an admin leaves no body unless they say so: everybody is one on this server)
    me2.send({ t: 'chat', text: '/voidinv off' });
    await sleep(200);
    await goAt(me2, toWorld(T, 0, STOREY + 2, 0));
    const sinceC = them2.got.length;
    me2.send({ t: 'died', cause: 'a test' });
    const body = await them2.until('death', () => true, 3000, sinceC);
    const corpse = body?.corpse;
    assert.ok(corpse && Math.abs(corpse.y - floorY) < 0.05, `the body lies at ${corpse?.y?.toFixed(2)} (the floor ${floorY.toFixed(2)}): ${JSON.stringify(body)}`);
    console.log(`  ok  on the tower's floor (${(floorY - data.groundAt(T.ox, T.oz)).toFixed(1)} m up): what a claim's store spills rests on it, and a body dead over it lies on it`);
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
