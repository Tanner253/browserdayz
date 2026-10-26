// Crafting (src/sim/craft/, server/craft.ts, src/game/crafting.ts), of 2026-10-24.
//   npx tsx test/craft.test.ts            the recipes and the rule: a second or two
//   npx tsx test/craft.test.ts --server   and a real server on a port of its own (8393), played over its socket: a hand
//                                         craft, and a workbench laid in the country and its queue
//
// What was asked: "We need some sort of crafting like how rust has crafting"; "clothing could be cut up with a knife or
// sharp object to make cloth which could be combined with rubbing alcohols to make iFAK's"; "when in doubt just ask how
// does rust/dayz do it". What is held to here: every recipe is made of real things, by hand in 2 to 6 s; clothes are cut
// into rags by their size, only empty and never worn, with a blade that wears; powder comes out of ten rounds of one
// kind, more from a rifle's; a batch makes as many as the pockets allow; two things dragged onto each other find their
// recipes. On the server: a craft is let begin only with what it takes, is done only after its time and standing still,
// takes what stacks as building's costs ('spent') and the clothes by their number, wears the blade, and gives what is made;
// a workbench's recipe is queued only at a bench of its level, runs while its maker stays, waits while they are away, and
// comes off; a forge lights itself with wood and ten fragments, makes a bar every 30 s of fire and leaves charcoal, and
// goes out; fragments come off a spot a blow at a time, twice as fast with a sledgehammer, the spot's scrap with the last,
// and come back two hours after; the wrecks' layer is the same every time, clear of every building and road. Blueprints
// (progression v3): the basics known from the start, the rest learned in a bench's tree in order for scrap, or at a
// research table from the thing itself; nothing unlearned is made; nails, hardware, steel plate and the best guns never.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';
import { CRAFT_ITEMS } from '../src/sim/items/craft';
import { RECIPE, RECIPES, RAGS, optionsOf } from '../src/sim/craft/recipes';
import { madeItems, most, needsOf, plan, pocketsOf, recipesFor, type Plan, type Pockets } from '../src/sim/craft/plan';
import { KNOWN_AT_START, TREE, learnable, mayUnlock, researchCost, teaches, waysToLearn } from '../src/sim/craft/learn';
import { MAT, PER_BAR } from '../src/sim/craft/materials';
import { TOOL_LIFE } from '../src/sim/gather';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { placeNear } from '../src/sim/craft/places';
import { FORGE, cold, forgeStep, lit } from '../src/sim/craft/forge';
import { SALVAGE, Scrapyard, salvageSpots, spotAt } from '../src/sim/craft/salvage';
import { WRECK_KINDS, wreckLayer, wreckSpots } from '../src/sim/craft/wrecks';
import { BUILDING_FOOTPRINT } from '../src/world/worldgen/layout';
import type { StoredItem } from '../src/net/protocol';
import { PIECES, PIECE_IDS } from '../src/sim/build/pieces';
import { Container } from '../src/sim/inventory';
import { Bases, heard, type Land } from '../src/sim/build/bases';
import { Solids, noBuilding, wetAt } from '../src/sim/build/land';
import { blocked, deployAt, nearestSpot, spots, toWorld } from '../src/sim/build/snap';
import { buildWorldData } from '../server/world';

let n = 0;
const failed: string[] = [];
const ok = (name: string, fn: () => void) => {
  try {
    fn();
    n++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed.push(name);
    console.log(`  NOT OK  ${name}\n          ${(e as Error).message}`);
  }
};
/** pockets of loose things (what may be used up), and worn ones (where only a tool may be) */
const pockets = (loose: ItemInstance[], worn: ItemInstance[] = []): Pockets => ({ free: loose, all: [...loose, ...worn] });
const made = (q: Plan | string): Plan => {
  assert.ok(typeof q !== 'string', `no plan: ${q}`);
  return q as Plan;
};

console.log('Crafting: the recipes and the rule');

ok('every recipe makes a real thing out of real things; by hand in 2 to 6 s; the workbench and the forge each have theirs', () => {
  for (const r of RECIPES) {
    assert.ok(ITEMS[r.makes], `${r.id} makes ${r.makes}`);
    for (const need of r.needs) for (const id of optionsOf(need)) assert.ok(ITEMS[id], `${r.id} needs ${id}`);
    if (r.at === 'hand') assert.ok(r.time >= 2 && r.time <= 6, `${r.id} takes ${r.time} s by hand`);
    if (r.by) for (const id of optionsOf(r.needs[0])) assert.ok(r.by[id] > 0, `${r.id}: nothing comes of ${id}`);
  }
  assert.ok(RECIPES.some((r) => r.at === 'bench') && RECIPES.some((r) => r.at === 'forge'));
  // (found, never made: the plan; nails loot-only, the owner: "they must be looted which is hard and time consuming";
  // the best guns loot-only, v3: "The best guns stay loot-only (gas, bunker, airdrops)")
  // (the code lock is made now, at a level II bench, and found rarely: the owner, 2026-10-25)
  for (const id of ['rubbing_alcohol', 'ammo_556', 'nails', 'metal_pipe', 'spring', 'gun_body_pistol', 'gun_body_rifle', 'deagle', 'benelli', 'barrett', 'sniper50', 'vssk', 'ar15', 'mp7a1', 'm32', 'scope_50'])
    assert.ok(!RECIPES.some((r) => r.makes === id), `${id} is made`);
  for (const r of RECIPES) if (r.at === 'bench') assert.ok(r.lv && r.lv >= 1 && r.lv <= 3, `${r.id} has no bench level`);
  assert.ok(ITEMS.rubbing_alcohol.loot && ITEMS.tin_can.loot, 'rubbing alcohol and the tin can are not found');
  assert.ok(ITEMS.satchel, 'the satchel charge is not an item');
});

ok('a jacket is cut into six rags with a knife, which wears a use; trousers four; a cap one', () => {
  const knife = makeItem('knife'), jacket = makeItem('field_jacket');
  const q = made(plan(RECIPE.rags, 1, pockets([jacket, knife])));
  assert.equal(q.makes, RAGS.field_jacket);
  assert.deepEqual(q.uids, [jacket.uid]);
  assert.deepEqual(q.wear, [knife.uid]);
  assert.equal(made(plan(RECIPE.rags, 1, pockets([makeItem('field_trousers'), knife]))).makes, 4);
  assert.equal(made(plan(RECIPE.rags, 1, pockets([makeItem('patrol_cap'), knife]))).makes, 1);
  assert.ok(TOOL_LIFE.knife && TOOL_LIFE.bone_knife && TOOL_LIFE.stone_hatchet && TOOL_LIFE.sledgehammer, 'a blade or a new tool does not wear');
});

ok('nothing is cut with nothing to cut with, nor a ruined knife; a jacket with things in its pockets, or a worn one, is not cut', () => {
  const jacket = makeItem('field_jacket');
  assert.match(plan(RECIPE.rags, 1, pockets([jacket])) as string, /something to cut with/);
  assert.equal(typeof plan(RECIPE.rags, 1, pockets([jacket, { ...makeItem('knife'), cond: 0 }])), 'string');
  const full = { ...makeItem('field_jacket'), cargo: [{ item: makeItem('apple'), x: 0, y: 0, rot: false }] };
  assert.equal(typeof plan(RECIPE.rags, 1, pockets([full, makeItem('knife')])), 'string', 'a jacket with an apple in it was cut up');
  // (worn: on the body, where only a tool may be; pocketsOf keeps the two apart)
  const worn = makeItem('field_jacket');
  const p = pocketsOf({ slots: { top: worn, held: makeItem('knife') }, active: null, containers: [] } as never);
  assert.ok(!p.free.includes(worn) && p.all.includes(worn), 'a worn jacket is free to be cut up');
  assert.equal(typeof plan(RECIPE.rags, 1, p), 'string', 'the jacket being worn was cut up');
  // (a knife worn in its place, a jacket in a pocket: cut)
  const inPocket = makeItem('field_jacket');
  const p2 = pocketsOf({ slots: { top: { ...makeItem('field_jacket'), cargo: [{ item: inPocket, x: 0, y: 0, rot: false }] }, holster: makeItem('knife') }, active: null, containers: [] } as never);
  assert.deepEqual(made(plan(RECIPE.rags, 1, p2)).uids, [inPocket.uid]);
});

ok('ten rifle rounds make two gunpowder and ten pistol rounds one; five of each make none; a satchel is a hundred rounds', () => {
  assert.equal(made(plan(RECIPE.gunpowder, 1, pockets([makeItem('ammo_556', 10)]))).makes, 2);
  assert.equal(made(plan(RECIPE.gunpowder, 1, pockets([makeItem('ammo_9mm', 10)]))).makes, 1);
  assert.equal(typeof plan(RECIPE.gunpowder, 1, pockets([makeItem('ammo_9mm', 5), makeItem('ammo_556', 5)])), 'string');
  const sat = RECIPE.satchel.needs.find((x) => x.id === 'gunpowder')!.n;
  assert.equal(sat * 10, 100, `a satchel takes ${sat} gunpowder`);
});

ok('a batch makes as many as the pockets allow: nine rags make two rope, and Max says two', () => {
  const p = pockets([makeItem('rags', 9)]);
  const q = made(plan(RECIPE.rope, 5, p));
  assert.equal(q.n, 2);
  assert.deepEqual(q.pay, { rags: 8 });
  assert.equal(q.time, RECIPE.rope.time * 2);
  assert.equal(most(RECIPE.rope, p), 2);
  const card = needsOf(RECIPE.rope, 2, p)[0];
  assert.deepEqual([card.have, card.need], [9, 8]);
  assert.match(plan(RECIPE.rope, 1, pockets([makeItem('rags', 3)])) as string, /1 more rags/);
});

ok('a bandage is two rags and a measure of alcohol; a first aid pouch three rags, two measures and a bandage', () => {
  const p = pockets([makeItem('rags', 10), makeItem('rubbing_alcohol', 5), makeItem('bandage', 1)]);
  assert.deepEqual(made(plan(RECIPE.bandage, 1, p)).pay, { rags: 2, rubbing_alcohol: 1 });
  assert.deepEqual(made(plan(RECIPE.aid_pouch, 1, p)).pay, { rags: 3, rubbing_alcohol: 2, bandage: 1 });
  assert.equal(ITEMS.rubbing_alcohol.stack, 5, 'a bottle is not five measures');
});

ok('two things dragged onto each other find their recipes: a knife on a jacket, rags on alcohol, rags on rags', () => {
  const ids = (a: string, b: string) => recipesFor(makeItem(a, ITEMS[a].stack ? 2 : undefined), makeItem(b, ITEMS[b].stack ? 2 : undefined)).map((r) => r.id);
  assert.deepEqual(ids('knife', 'field_jacket'), ['rags']);
  assert.deepEqual(ids('field_jacket', 'bone_knife'), ['rags']);
  assert.deepEqual(ids('rags', 'rubbing_alcohol'), ['bandage', 'aid_pouch']);
  assert.ok(ids('rags', 'rags').includes('rope'));
  assert.deepEqual(ids('stone', 'planks'), ['stone_hatchet', 'forge']);
  assert.deepEqual(ids('knife', 'apple'), []);
  // (a workbench's recipes are not made by dragging)
  assert.deepEqual(ids('iron_bar', 'planks'), []);
});

ok('a workbench is near when one stands within 4 m on the same floor, not on the floor above', () => {
  const land: Land = { ground: () => 0, why: () => null, solids: () => [] };
  const bs = new Bases(land), base = bs.lay({ k: 'foundation', x: 0, y: 0, z: 0, r: 0, yaw: 0 }, 'me', 0);
  assert.ok(typeof base !== 'string', String(base));
  const b = (base as { base: Parameters<typeof deployAt>[0] }).base;
  const at = deployAt(b, 'workbench', { x: 0, y: 0, z: 0 })!;
  assert.ok(typeof bs.lay({ b: b.id, k: 'workbench', ...at }, 'me', 0) !== 'string');
  const [wx, wy, wz] = toWorld(b, at.x, at.y, at.z);
  assert.ok(placeNear(bs, 'bench', wx + 3, wy, wz), 'a bench 3 m off was not near');
  assert.equal(placeNear(bs, 'bench', wx + 5, wy, wz), null, 'a bench 5 m off was near');
  assert.equal(placeNear(bs, 'bench', wx + 1, wy + 3, wz), null, 'a bench on the floor below was near');
  assert.equal(placeNear(bs, 'forge', wx, wy, wz), null, 'a bench was a forge');
  // (its level: one unsaid, the best of those within reach)
  assert.equal(placeNear(bs, 'bench', wx + 1, wy, wz)?.lv, 1);
  const p = [...b.pieces.values()].find((q) => q.k === 'workbench')!;
  p.t = 3;
  assert.equal(placeNear(bs, 'bench', wx + 1, wy, wz)?.lv, 3, 'a Bench III was not three');
});

ok('blueprints: the basics known; each tree in order, at its level, for its scrap; research costs less and uses the thing up', () => {
  // (every recipe still to learn is in exactly one tree, at its own bench's level; the start knows every hand recipe)
  const inTrees = Object.entries(TREE).flatMap(([lv, line]) => line.map(([id]) => ({ id, lv: Number(lv) })));
  for (const r of RECIPES.filter((x) => learnable(x))) {
    const at = inTrees.filter((t) => t.id === r.id);
    assert.equal(at.length, 1, `${r.id} is in ${at.length} trees`);
    assert.equal(at[0].lv, r.lv, `${r.id} is a Bench ${r.lv} recipe in the Bench ${at[0].lv} tree`);
  }
  for (const t of inTrees) assert.ok(learnable(RECIPE[t.id]), `${t.id} is in a tree and needs no learning`);
  for (const r of RECIPES.filter((x) => x.at === 'hand')) assert.ok(KNOWN_AT_START.has(r.id), `${r.id} is not known by hand`);
  for (const line of Object.values(TREE)) for (let i = 1; i < line.length; i++) assert.ok(line[i][1] >= line[i - 1][1], 'a tree is not cheaper first');
  const none = new Set<string>();
  assert.equal(mayUnlock('pickaxe', none, 1, 999), null);
  assert.match(mayUnlock('hand_saw', none, 1, 999)!, /first/, 'a tree was skipped along');
  assert.match(mayUnlock('colt', new Set(TREE[2].slice(0, 4).map(([id]) => id)), 1, 999)!, /Bench II/, 'a Bench II recipe was unlocked at a Bench I');
  assert.match(mayUnlock('pickaxe', none, 0, 999)!, /Bench I/);
  assert.match(mayUnlock('pickaxe', none, 1, 5)!, /takes/);
  assert.ok(researchCost('colt') < TREE[2].find(([id]) => id === 'colt')![1]);
  assert.equal(teaches('colt')?.id, 'colt');
  assert.equal(teaches('deagle'), undefined, 'a loot-only gun taught a blueprint');
  assert.equal(teaches('hammer'), undefined, 'a thing known from the start taught one');
  // (the card's ways: at a table with the gun and the scrap, it may be researched)
  const colt = madeItems('colt', 1)[0], scrap = makeItem(MAT.scrap, 200);
  assert.equal(waysToLearn(RECIPE.colt, none, [colt, scrap], 0, true)?.research.why, null);
  assert.match(waysToLearn(RECIPE.colt, none, [colt, scrap], 0, false)!.research.why!, /research table/);
  assert.equal(waysToLearn(RECIPE.hammer, none, [], 0, true), null, 'a known recipe has ways to learn it');
  // (a made gun is whole: its own magazine in it, empty)
  assert.equal(colt.mag, ITEMS.colt.weapon!.mag);
  assert.equal(colt.loaded, 0);
});

ok(`a forge with logs and ${PER_BAR * 2} fragments makes a bar every 30 s, leaves two charcoal a log, and goes out with none left`, () => {
  // (its store takes a log: six wide, a log lies in it on its side)
  const [sw, sh] = PIECES.forge.store!;
  assert.ok(Container.size(makeItem('log'), true)[0] <= sw && Container.size(makeItem('log'), true)[1] <= sh, `a log does not fit the forge's ${sw}x${sh}`);
  const items: StoredItem[] = [{ ...makeItem('log', 1), x: 0, y: 0, rot: false }, { ...makeItem(MAT.frags, PER_BAR * 2), x: 2, y: 0, rot: false }];
  const f = cold();
  let t = 0;
  const count = (id: string) => items.reduce((n, it) => n + (it.id === id ? it.qty : 0), 0);
  forgeStep(f, items, 6, 4, 1);
  assert.ok(lit(f) && count('log') === 0, 'it did not light on its log');
  for (t = 1; t < FORGE.smelt; t++) forgeStep(f, items, 6, 4, 1);
  assert.equal(count('iron_bar'), 1, `after ${t} s: ${count('iron_bar')} bars`);
  assert.equal(count(MAT.frags), PER_BAR);
  for (; t < FORGE.smelt * 2; t++) forgeStep(f, items, 6, 4, 1);
  assert.equal(count('iron_bar'), 2);
  assert.equal(count(MAT.frags), 0);
  for (; t < FORGE.fuel.log + 2; t++) forgeStep(f, items, 6, 4, 1);
  assert.ok(!lit(f), 'it burned on with nothing to smelt');
  assert.equal(count('coal'), FORGE.ash.log, `charcoal: ${count('coal')}`);
  // (wood and no fragments: it does not light)
  const dry: StoredItem[] = [{ ...makeItem('log', 2), x: 0, y: 0, rot: false }, { ...makeItem(MAT.scrap, 50), x: 2, y: 0, rot: false }], g = cold();
  forgeStep(g, dry, 6, 4, 1);
  assert.ok(!lit(g) && dry[0].qty === 2, 'a forge with no fragments burned its wood');
});

ok('fragments come off a spot a blow at a time, twice as fast with a sledgehammer, its scrap with the last; back two hours on', () => {
  const spots = salvageSpots([{ kind: 'covered_car', x: 0, y: 0, z: 0, rot: 0, scale: 1 }, { kind: 'Barrel_01', x: 20, y: 0, z: 0, rot: 0, scale: 1 }, { kind: 'pine_a', x: 40, y: 0, z: 0, rot: 0, scale: 1 }]);
  assert.equal(spots.length, 2, 'a tree is salvage');
  assert.equal(spotAt(spots, 1, 1, 0.5), 0);
  assert.equal(spotAt(spots, 20.5, 0.5, 0), 1);
  assert.equal(spotAt(spots, 10, 0.5, 0), -1);
  const yard = new Scrapyard(spots), t0 = 1e6;
  assert.equal(yard.blow(0, SALVAGE.tools.hammer, t0)!.give, 1);
  assert.equal(yard.blow(0, SALVAGE.tools.sledgehammer, t0)!.give, 2);
  let got = 3, scrap = 0;
  while (yard.left(0) > 0) {
    const b = yard.blow(0, SALVAGE.tools.sledgehammer, t0)!;
    got += b.give;
    scrap += b.scrap;
  }
  assert.equal(got, spots[0].frags);
  assert.equal(scrap, spots[0].scrap, 'the stripping blow gave no scrap');
  assert.equal(yard.blow(0, 1, t0)!.give, 0, 'a stripped car still gave fragments');
  assert.deepEqual(yard.rust(t0 + SALVAGE.back * 1000 - 1, () => false), []);
  assert.deepEqual(yard.rust(t0 + SALVAGE.back * 1000 + 1, () => true), [], 'it came back with somebody stood at it');
  assert.deepEqual(yard.rust(t0 + SALVAGE.back * 1000 + 1, () => false), [0]);
  assert.equal(yard.left(0), spots[0].frags);
});

ok('every crafting thing is drawn with a model of its own, brought in, and has its picture in the pockets', () => {
  const models = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')).models, icons = JSON.parse(readFileSync('public/assets/icons/index.json', 'utf8'));
  for (const d of CRAFT_ITEMS) {
    assert.ok(models[d.model], `${d.id}'s model ${d.model} is not in the manifest`);
    assert.ok(icons[d.id], `${d.id} has no picture`);
  }
});

// ---------------------------------------------------------------- the server
if (process.argv.includes('--server')) await serverTest();
if (failed.length) {
  console.error(`CRAFT TEST FAILED: ${failed.length} of ${n + failed.length}: ${failed.join('; ')}`);
  process.exit(1);
}
console.log(`CRAFT TEST PASSED (${n})`);
process.exit(0);

async function serverTest() {
  const PORT = 8393, SITE = 'http://127.0.0.1:9';
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting a server');
  console.log('Crafting: on a server (port 8393)');
  // (a place out in the country a base may go, as the server will judge it: base building's test finds one the same way)
  const data = buildWorldData(process.cwd());
  const solids = new Solids(data.trees, data.rocks), wet = wetAt(data.water, (x, z) => data.groundAt(x, z));
  const land: Land = { ground: (x, z) => data.groundAt(x, z), why: (x, z) => noBuilding(x, z, data.places, data.buildings, data.spawns, wet), solids: (x, z, w) => solids.near(x, z, w) };
  let site: [number, number] | null = null;
  for (let x = -2400; x < 2400 && !site; x += 37) for (let z = -1500; z < 1500 && !site; z += 41) {
    const bs = new Bases(land), got = bs.lay({ k: 'foundation', x, y: 0, z, r: 0, yaw: 0 }, 'craft-test', 0);
    if (typeof got === 'string') continue;
    const sp = nearestSpot(spots(got.base, 'foundation'), 'foundation', { x: 3, y: 0, z: 0 }, 1);
    if (sp && !blocked(got.base, 'foundation', sp, bs.groundIn(got.base))) site = [x, z];
  }
  assert.ok(site, 'no place on the map a base may go');
  // (the wrecks' layer, on the map as it is (its buildings planned, their furniture among the props, as both the game and
  // the server have it): the same twice, clear of buildings and roads, and every one a salvage spot)
  const { generateWorld } = await import('../src/world/worldgen');
  const { Buildings } = await import('../src/world/buildings');
  const gw = generateWorld();
  new Buildings(gw, null as never).plan();
  const wrecks = wreckLayer(gw);
  assert.deepEqual(wreckLayer(gw), wrecks, 'the layer is not the same twice');
  assert.ok(wrecks.length >= 20, `only ${wrecks.length} wrecks`);
  for (const w of wrecks) {
    for (const b of gw.buildings) {
      const [fw, fd] = BUILDING_FOOTPRINT[b.type] ?? [10, 10];
      assert.ok(Math.hypot(w.x - b.x, w.z - b.z) > Math.min(fw, fd) / 2, `a ${w.kind} at ${w.x.toFixed(0)}, ${w.z.toFixed(0)} is in a ${b.type}`);
    }
  }
  assert.equal(data.salvage.length, salvageSpots(gw.props).length + wrecks.length, 'the server numbers salvage otherwise');
  assert.deepEqual(data.salvage.slice(-wrecks.length).map((q) => q.kind), wreckSpots(wrecks).map((q) => q.kind));
  console.log(`  ok  ${wrecks.length} wrecks laid by their own layer (${Object.keys(WRECK_KINDS).map((k) => `${wrecks.filter((w) => w.kind === k).length} ${k}`).join(', ')}), the same twice, clear of every building; ${data.salvage.length} salvage spots`);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-craft-'));
  const server = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '0', LOCAL_ADMIN: '1', INFECTED: 'off', ANIMALS: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logged = '';
  server.stdout!.on('data', (d) => (logged += d));
  server.stderr!.on('data', (d) => (logged += d));

  const ws = await (async () => {
    for (let k = 0; k < 1500 && !logged.includes('listening'); k++) await sleep(100);
    assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
    const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise<void>((done, fail) => {
      s.once('open', () => done());
      s.once('error', fail);
    });
    return s;
  })().catch((e) => {
    server.kill();
    throw e;
  });
  const got: S2C[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d)) as S2C));
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  const of = <T extends S2C['t']>(t: T) => got.filter((m) => m.t === t) as Extract<S2C, { t: T }>[];
  const until = async <T extends S2C['t']>(t: T, test: (m: Extract<S2C, { t: T }>) => boolean = () => true, ms = 4000, from = 0) => {
    for (let k = 0; k < ms / 25; k++) {
      const m = (got.slice(from).filter((q) => q.t === t) as Extract<S2C, { t: T }>[]).find(test);
      if (m) return m;
      await sleep(25);
    }
    return null;
  };
  let pockets: ItemInstance[] = [];
  const me = () => send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'gear', items: pockets.map((it, i) => ({ ...it, x: (i * 3) % 12, y: Math.floor(i / 4) * 6, rot: false })) }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false }, sp: Math.max(0, ...of('spent').map((m) => m.n)) });
  let pos: [number, number, number] = [0, 0, 0];
  const pose = () => send({ t: 's', p: [pos[0], pos[1], pos[2], 0, 0, 0], w: null, m: [] });

  let fail: unknown = null;
  try {
    send({ t: 'hello', v: PROTOCOL, key: 'craft-test-key-'.padEnd(40, '0'), name: 'Tailor', fp: 'fp-tailor'.padEnd(64, 'a') });
    const welcome = await until('welcome', () => true, 15000);
    assert.ok(welcome, `not let in: ${JSON.stringify(got).slice(0, 300)}`);
    const spawned = await until('spawn', () => true, 8000);
    if (spawned && 'x' in spawned) pos = [Number((spawned as { x: number }).x), Number((spawned as { y?: number }).y ?? 0), Number((spawned as { z: number }).z)];
    pose();
    const jacket = makeItem('field_jacket'), knife = makeItem('knife');
    pockets = [jacket, knife, makeItem('rags', 3), makeItem('rubbing_alcohol', 5)];
    me();
    await sleep(200);

    // too little: rope wants four rags, and three are carried
    send({ t: 'craft', r: 'rope', n: 1, go: 1 });
    const short = await until('craft', (m) => m.r === 'rope');
    assert.ok(short && !short.ok && /1 more rags/.test(short.why ?? ''), `rope with three rags: ${JSON.stringify(short)}`);
    console.log('  ok  a craft is not let begin without what it takes, and says what is short');

    // a workbench's recipe is not made by hand
    send({ t: 'craft', r: 'hammer', n: 1, go: 1 });
    assert.ok((await until('craft', (m) => m.r === 'hammer'))?.why?.includes('workbench'));
    // (and what has been learned is told when they come in: nothing yet)
    assert.deepEqual((await until('known'))?.r, [], 'the known list was not told on joining');

    // the jacket into rags: begun; said done at once, not believed; done after its time, standing still
    send({ t: 'craft', r: 'rags', n: 1, go: 1, u: [jacket.uid, knife.uid] });
    const begun = await until('craft', (m) => m.r === 'rags');
    assert.ok(begun?.ok && begun.time === RECIPE.rags.time, `the rags were not begun: ${JSON.stringify(begun)}`);
    send({ t: 'craft', r: 'rags', n: 1, go: 2, u: [jacket.uid, knife.uid] });
    assert.ok(await until('craft', (m) => m.r === 'rags' && !m.ok && /too quickly/.test(m.why ?? '')), 'a craft said done at once was believed');
    send({ t: 'craft', r: 'rags', n: 1, go: 1, u: [jacket.uid, knife.uid] });
    await sleep(RECIPE.rags.time * 1000 + 100);
    const kits = of('kit').length;
    send({ t: 'craft', r: 'rags', n: 1, go: 2, u: [jacket.uid, knife.uid] });
    const done = await until('craft', (m) => m.r === 'rags' && !!m.done);
    assert.ok(done, 'the rags were never done');
    assert.deepEqual(done.used, [jacket.uid], 'the jacket was not used up by its number');
    const rags = (await until('kit', () => of('kit').length > kits)) && of('kit').slice(kits).flatMap((m) => m.items).find((it) => it.id === 'rags');
    assert.equal(rags?.qty, RAGS.field_jacket, `rags given: ${JSON.stringify(rags)}`);
    assert.ok(await until('wear', (m) => m.u === knife.uid && m.c < 1), 'the knife did not wear');
    console.log(`  ok  a jacket became ${RAGS.field_jacket} rags after ${RECIPE.rags.time} s, not at once; it went by its number and the knife wore`);

    // the game takes them in (its word on its pockets): now rope, two of it, and what stacks comes out as 'spent'
    pockets = [knife, makeItem('rags', 3 + RAGS.field_jacket), makeItem('rubbing_alcohol', 5)];
    me();
    await sleep(150);
    send({ t: 'craft', r: 'rope', n: 5, go: 1 });
    const rope = await until('craft', (m) => m.r === 'rope' && m.ok);
    assert.equal(rope?.n, 2, `nine rags let ${rope?.n} rope begin`);
    await sleep(RECIPE.rope.time * 2000 + 100);
    send({ t: 'craft', r: 'rope', n: 5, go: 2 });
    assert.ok(await until('craft', (m) => m.r === 'rope' && !!m.done), 'the rope was never done');
    const spent = await until('spent', (m) => m.items.some(([id]) => id === 'rags'));
    assert.deepEqual(spent?.items, [['rags', 8]], `spent: ${JSON.stringify(spent)}`);
    assert.ok(await until('kit', (m) => m.items.some((it) => it.id === 'rope' && it.qty === 1) && m.items.length === 2), 'two rope were not given');
    console.log('  ok  nine rags made two rope; eight came out of the pockets as building\'s costs do, and the rope went in');

    // walking off during the hold stops it
    pockets = [makeItem('rags', 4)];
    me();
    await sleep(150);
    send({ t: 'craft', r: 'rope', n: 1, go: 1 });
    assert.ok(await until('craft', (m) => m.r === 'rope' && m.ok && m.n === 1 && !m.done && got.indexOf(m) > got.indexOf(spent!)));
    pos = [pos[0] + 2, pos[1], pos[2]];
    pose();
    await sleep(RECIPE.rope.time * 1000 + 100);
    send({ t: 'craft', r: 'rope', n: 1, go: 2 });
    assert.ok(await until('craft', (m) => m.r === 'rope' && !m.ok && /moved/.test(m.why ?? '')), 'a craft walked away from was still made');
    console.log('  ok  walking off during the hold stops it, and nothing is used up');

    // a workbench, laid in the country: a foundation and the bench on it, paid for out of what /give gave
    const kit = async (text: string) => {
      const had = of('kit').length;
      send({ t: 'chat', text });
      for (let k = 0; k < 160 && of('kit').length === had; k++) await sleep(25);
      const items = of('kit')[had]?.items ?? [];
      assert.ok(items.length, `${text} gave nothing`);
      return items;
    };
    const go = async (x: number, z: number) => {
      const had = of('put').length;
      send({ t: 'chat', text: `/tp ${x.toFixed(2)} ${z.toFixed(2)}` });
      for (let k = 0; k < 160 && of('put').length === had; k++) await sleep(25);
      pos = [x, data.groundAt(x, z), z];
      pose();
      await sleep(80);
    };
    const [sx, sz] = site!;
    const planPaper = (await kit('/give building_plan'))[0];
    // (a workbench and a research table are set down from the hands, made as items: base building's PLACED)
    const bench = (await kit('/give workbench'))[0], table = (await kit('/give research_table'))[0];
    pockets = [planPaper, bench, table, ...(await kit('/give planks 50')), ...(await kit('/give log 4')), ...(await kit('/give nails 20')), ...(await kit('/give metal_frags 75')), ...(await kit('/give scrap 25'))];
    me();
    await go(sx - 2, sz);
    send({ t: 's', p: [pos[0], pos[1], pos[2], 0, 0, 0], w: 'building_plan', m: [] });
    await sleep(80);
    send({ t: 'blay', k: 'foundation', x: sx, y: 0, z: sz, r: 0, yaw: 0, u: planPaper.uid });
    const told = await until('base');
    assert.ok(told, `no base: ${JSON.stringify(of('tell').slice(-2))}`);
    const b = heard(told.b)!;
    const spot = deployAt(b, 'workbench', { x: 0, y: 0, z: 0 })!;
    send({ t: 'blay', k: 'workbench', b: b.id, ...spot, u: bench.uid });
    const wb = await until('bpc');
    assert.ok(wb, `no workbench: ${JSON.stringify(of('tell').slice(-2))}`);
    const [bx, , bz] = toWorld(b, spot.x, spot.y, spot.z);
    // (and a research table beside it: by a bench, as Bench I makes it)
    const tspot = deployAt(b, 'research_table', { x: 0, y: 0, z: 1.05 });
    assert.ok(tspot, 'no room on the foundation for a research table beside the bench');
    send({ t: 'blay', k: 'research_table', b: b.id, ...tspot, u: table.uid });
    assert.ok(await until('bpc', (m) => m.p[1] === PIECE_IDS.indexOf('research_table')), `no research table: ${JSON.stringify(of('tell').slice(-2))}`);

    // hammers, queued at the bench: two lots; made one after the other while the maker stays, the fragments taken as each is
    pockets = [makeItem(MAT.frags, 150), makeItem('planks', 3)];
    me();
    await go(bx + 2, bz);
    // (standing by it is not using it: F at it is, as Rust's; the owner, "I should have to press F on the workbench to use it")
    const c0 = got.length;
    send({ t: 'cq', r: 'hammer', n: 1 });
    assert.ok((await until('craft', (m) => !m.ok, 3000, c0))?.why?.includes('F at it'), `queued at a bench not used: ${JSON.stringify(of('craft').slice(-1))}`);
    send({ t: 'bench', b: b.id, p: wb!.p[0] });
    await sleep(80);
    const k0 = of('kit').length, g0 = got.length;
    send({ t: 'cq', r: 'hammer', n: 2 });
    const q1 = await until('cq', (m) => m.q.length === 1);
    assert.deepEqual(q1?.q, [{ r: 'hammer', n: 2 }], `queued: ${JSON.stringify(q1)} ${JSON.stringify(of('craft').slice(-1))}`);
    await until('kit', (m) => m.items.some((it) => it.id === 'hammer'), RECIPE.hammer.time * 1000 + 5000, g0);
    const hammers = of('kit').slice(k0).flatMap((m) => m.items).filter((it) => it.id === 'hammer');
    assert.equal(hammers.length, 1, `after one job's time: ${JSON.stringify(hammers)}`);
    assert.ok(await until('spent', (m) => m.items.some(([id, k]) => id === MAT.frags && k === 50)), 'no fragments were taken for the hammer');
    console.log(`  ok  hammers queued at a workbench: the first made after ${RECIPE.hammer.time} s, its fragments taken as it was`);

    // walked off: it waits; back: it goes on; taken off: the queue is empty and nothing more is made
    pockets = [makeItem(MAT.frags, 100), makeItem('planks', 2)];
    me();
    await go(bx + 12, bz);
    assert.ok(await until('cq', (m) => m.paused && m.q.length === 1), 'walking off the bench did not pause the queue');
    await sleep(1000);
    const k1 = of('kit').length, back = got.length;
    await go(bx + 2, bz);
    assert.ok(await until('cq', (m) => !m.paused && m.q.length === 1, 4000, back), 'coming back did not run the queue on');
    send({ t: 'cqx', i: 0 });
    assert.ok(await until('cq', (m) => m.q.length === 0), 'the job did not come off');
    await sleep(RECIPE.hammer.time * 1000 + 500);
    assert.equal(of('kit').slice(k1).flatMap((m) => m.items).filter((it) => it.id === 'hammer').length, 0, 'hammers were made after the job came off');
    console.log('  ok  walked off it waits, back it goes on, and taken off nothing more is made');

    // blueprints: not learned, not queued; the tree's first unlocked for its scrap; the second not before the first;
    // a Bench II recipe not at a Bench I; a found pistol researched at the table, used up, learned for good
    const g1 = got.length;
    pockets = [makeItem(MAT.scrap, 200), makeItem(MAT.frags, 100), makeItem('planks', 2), ...madeItems('colt', 1)];
    const colt = pockets[3];
    me();
    await sleep(120);
    send({ t: 'cq', r: 'pickaxe', n: 1 });
    assert.ok(await until('craft', (m) => m.r === 'pickaxe' && !m.ok && /learned/.test(m.why ?? ''), 4000, g1), 'an unlearned recipe was queued');
    send({ t: 'learn', op: 'tree', r: 'hand_saw' });
    assert.ok(await until('learn', (m) => !m.ok && /first/.test(m.why ?? ''), 4000, g1), 'the tree was skipped along');
    send({ t: 'learn', op: 'tree', r: 'pickaxe' });
    assert.ok(await until('known', (m) => m.r.includes('pickaxe'), 4000, g1), 'the pickaxe was not learned');
    assert.ok(await until('spent', (m) => m.items.some(([id, k]) => id === MAT.scrap && k === TREE[1][0][1]), 4000, g1), 'its scrap was not taken');
    send({ t: 'cq', r: 'sheet_metal', n: 1 });
    assert.ok(await until('craft', (m) => m.r === 'sheet_metal' && !m.ok, 4000, g1), 'a Bench II recipe went on unlearned');
    send({ t: 'learn', op: 'research', u: colt.uid });
    const learned = await until('learn', (m) => m.ok && m.r === 'colt', 4000, g1);
    assert.ok(learned, `the pistol was not researched: ${JSON.stringify(of('learn').slice(-1))}`);
    assert.deepEqual(learned.used, [colt.uid], 'the pistol was not used up by its number');
    assert.ok(await until('known', (m) => m.r.includes('colt') && m.r.includes('pickaxe'), 4000, g1));
    pockets = [makeItem(MAT.scrap, 200 - TREE[1][0][1] - researchCost('colt')), makeItem(MAT.frags, 100), makeItem('planks', 2), makeItem('iron_bar', 6), makeItem('spring', 1), makeItem('metal_pipe', 1), makeItem('gun_body_pistol', 1)];
    me();
    await sleep(120);
    send({ t: 'cq', r: 'colt', n: 1 });
    assert.ok(await until('craft', (m) => m.r === 'colt' && !m.ok && /Bench II/.test(m.why ?? ''), 4000, g1), 'a pistol was queued at a Bench I');
    console.log('  ok  blueprints: unlearned refused, the tree in order for its scrap, a pistol researched and used up, and Bench II\'s pistol not made at a Bench I');

    // queued far from any bench: refused
    await go(bx + 30, bz);
    send({ t: 'cq', r: 'hammer', n: 1 });
    assert.ok(await until('craft', (m) => m.r === 'hammer' && !m.ok && /workbench/.test(m.why ?? '')), 'queued with no bench near');
    console.log('  ok  nothing is queued away from a workbench');

    // salvage: a hammer on a fuel drum gives a fragment a blow, and the server says how far through it is
    const drum = data.salvage.findIndex((q) => q.kind === 'Barrel_01' && Math.abs(q.x) < 1500 && Math.abs(q.z) < 1500);
    const D = data.salvage[drum];
    const hammer = (await kit('/give hammer'))[0];
    pockets = [hammer];
    me();
    await go(D.x + 1, D.z);
    send({ t: 's', p: [pos[0], pos[1], pos[2], 0, 0, 0], w: 'hammer', m: [] });
    await sleep(100);
    const k2 = of('kit').length;
    send({ t: 'salvage', i: drum, u: hammer.uid });
    const blow = await until('salvage', (m) => m.i === drum);
    assert.ok(blow && blow.done > 0, `no blow: ${JSON.stringify(of('tell').slice(-1))}`);
    assert.ok(await until('kit', (m) => m.items.some((it) => it.id === MAT.frags && it.qty === 1)), 'no fragment given');
    // (too soon after: not believed; from too far: not believed)
    send({ t: 'salvage', i: drum, u: hammer.uid });
    await sleep(200);
    assert.equal(of('salvage').filter((m) => m.i === drum).length, 1, 'a second blow at once was believed');
    await go(D.x + 6, D.z);
    send({ t: 's', p: [pos[0], pos[1], pos[2], 0, 0, 0], w: 'hammer', m: [] });
    await sleep(ITEMS.hammer.melee!.rate * 1000 + 100);
    send({ t: 'salvage', i: drum, u: hammer.uid });
    await sleep(300);
    assert.equal(of('salvage').filter((m) => m.i === drum).length, 1, 'a blow from 6 m off was believed');
    assert.ok(of('kit').slice(k2).length >= 1);
    console.log('  ok  a hammer on a fuel drum knocks a fragment off, not faster than it swings nor from 6 m off');
  } catch (e) {
    fail = e;
  } finally {
    ws.close();
    if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    await sleep(300);
    rmSync(dir, { recursive: true, force: true });
  }
  if (fail) {
    failed.push('the server');
    console.log(`  NOT OK  the server: ${fail instanceof Error ? fail.message : fail}\n--- server log tail ---\n${logged.slice(-1500)}`);
  } else n++;
}
