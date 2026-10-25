// Raiding (src/sim/build/raid.ts): what a blow and a charge do to a base, 2026-10-25.
//   npx tsx test/raid.test.ts
//
// What was asked (the navigator's order): "C4 and satchel as explosives, C4 as loot, far more tool blows". So: tools
// bite into wood, a pickaxe and a sledgehammer into stone, nothing into metal but a sledgehammer, a little; one C4
// takes a wooden wall, two a stone one, four a metal one, a satchel one wooden door; the wall a charge is stuck to takes
// it, and what is behind that wall does not.

import assert from 'node:assert/strict';
import { Bases, type Land } from '../src/sim/build/bases';
import { STOREY, WALL_T, hpOf, type Tier } from '../src/sim/build/pieces';
import { RAID, blastOn, blowOf, chargeOf } from '../src/sim/build/raid';
import { BaseSolids } from '../src/sim/build/solid';
import { toWorld, type Piece } from '../src/sim/build/snap';
import { layPrint } from '../src/sim/build/blueprints';
import { ITEMS } from '../src/sim/items';

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

/** the two-storey house from its blueprint, every piece brought up to `t` (a fitting keeps its own) */
const house = (t: Tier) => {
  const bs = new Bases(flat), b = layPrint(bs, 'bp:house', { x: 0, z: 0, yaw: 0 }, 'me', 0, 'Me', () => true).base!;
  for (const p of b.pieces.values()) {
    p.t = t;
    p.hp = hpOf(p.k, t);
  }
  const all = [...b.pieces.values()], piece = (k: string, x: number, z: number, y?: number) => all.find((p) => p.k === k && Math.abs(p.x - x) < 0.1 && Math.abs(p.z - z) < 0.1 && (y === undefined || Math.abs(p.y - y) < 0.6))!;
  return { b, piece, solid: new BaseSolids(() => bs.bases.values()), w: (x: number, y: number, z: number) => toWorld(b, x, y, z) };
};
/** how many of a charge, each at a hand's breadth, a piece takes to break */
const count = (w: string, p: Piece) => Math.ceil(p.hp / chargeOf(w, p, 0));

console.log('Raiding: blows');
ok('tools bite into wood; a pickaxe and a sledgehammer into stone; only a sledgehammer, a little, into metal', () => {
  const { piece } = house(1), wall = piece('wall', 0, -1.5);
  assert.equal(blowOf('felling_axe', wall), 7);
  assert.ok(blowOf('hatchet', wall) > blowOf('stone_hatchet', wall) && blowOf('stone_hatchet', wall) > 0);
  wall.t = 2;
  assert.equal(blowOf('hatchet', wall), 0, 'an axe on stone');
  assert.ok(blowOf('pickaxe', wall) > 0 && blowOf('sledgehammer', wall) > 0);
  wall.t = 3;
  assert.equal(blowOf('pickaxe', wall), 0, 'a pickaxe on metal');
  assert.equal(blowOf('sledgehammer', wall), 2);
  assert.equal(blowOf('hammer', wall), 0, 'the building hammer breaks nothing');
  wall.t = 0;
  assert.equal(blowOf('machete', wall), RAID.other[0], 'anything else, on a frame');
});
ok('far more blows than a charge: a wooden wall is dozens of axe blows, a stone wall hundreds of the sledgehammer', () => {
  const { piece } = house(1), wall = piece('wall', 0, -1.5);
  assert.ok(wall.hp / blowOf('felling_axe', wall) >= 60, `${wall.hp / blowOf('felling_axe', wall)} axe blows`);
  wall.t = 2;
  wall.hp = hpOf('wall', 2);
  assert.ok(wall.hp / blowOf('sledgehammer', wall) >= 150, `${wall.hp / blowOf('sledgehammer', wall)} sledgehammer blows`);
});
ok('every tool that raids is a thing held to strike with', () => {
  for (const id of Object.keys(RAID.blow)) assert.ok(ITEMS[id]?.melee, id);
});

console.log('Raiding: charges');
ok('one C4 takes a wooden wall, two a stone one, four a metal one; a satchel one wooden door, ten stone walls', () => {
  for (const [t, c4] of [[1, 1], [2, 2], [3, 4]] as [Tier, number][]) {
    const { piece } = house(t);
    assert.equal(count('c4', piece('wall', 0, -1.5)), c4, `C4 on tier ${t}`);
  }
  const { piece } = house(1);
  assert.equal(count('satchel', piece('door_wood', 0, 4.5)), 1, 'a satchel on a wooden door');
  assert.equal(count('satchel', house(2).piece('wall', 0, -1.5)), 10, 'satchels on a stone wall');
});
ok('the wall a C4 is stuck to takes all of it; what is behind that wall, nothing', () => {
  const { piece, solid, w } = house(2), wall = piece('wall', 0, -1.5);
  // (on the wall's outside face, at chest height)
  const at = w(0, wall.y + 1.2, -1.5 - WALL_T / 2 - 0.04);
  const hit = blastOn(solid, at, 'c4');
  const mine = hit.find((h) => h.p === wall);
  assert.ok(mine, 'the wall it is on');
  assert.equal(mine!.hp, wall.hp - RAID.charge.c4.dmg[2], 'all of it');
  assert.ok(!hit.some((h) => h.p === piece('wall', -1.5, 0)), 'the wall round the corner, behind it');
  assert.ok(!hit.some((h) => h.p === piece('stairs_u', 3, 3)), 'the stairs inside');
  assert.ok(!hit.some((h) => h.p.y >= STOREY), 'nothing upstairs');
});
ok('two C4 on one stone wall break it; the C4 on a wooden door breaks the door', () => {
  const { piece, solid, w } = house(2), wall = piece('wall', 0, -1.5);
  const at = w(0, wall.y + 1.2, -1.5 - WALL_T / 2 - 0.04);
  for (let i = 0; i < 2; i++) for (const h of blastOn(solid, at, 'c4')) h.p.hp = h.hp;
  assert.ok(wall.hp <= 0, `left ${wall.hp}`);
  const door = piece('door_wood', 0, 4.5);
  const on = blastOn(solid, w(0, door.y + 1.1, 4.5 + 0.12), 'c4').find((h) => h.p === door);
  assert.ok(on && on.hp <= 0, 'the door');
});
ok('a charge reaches less the further it is, and nothing past its reach', () => {
  const { piece } = house(2), wall = piece('wall', 0, -1.5);
  assert.ok(chargeOf('c4', wall, 1) < chargeOf('c4', wall, 0) && chargeOf('c4', wall, 1) > 0);
  assert.equal(chargeOf('c4', wall, RAID.charge.c4.reach + 0.1), 0);
});

console.log(failed.length ? `\n${failed.length} NOT OK of ${n + failed.length}: ${failed.join('; ')}` : `\nall ${n} ok`);
process.exit(failed.length ? 1 : 0);
