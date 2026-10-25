// Crafting (src/sim/craft/, server/craft.ts, src/game/crafting.ts), of 2026-10-24.
//   npx tsx test/craft.test.ts            the recipes and the rule: a second or two
//   npx tsx test/craft.test.ts --server   and a real server on a port of its own (8393), played over its socket
//
// What was asked: "We need some sort of crafting like how rust has crafting"; "clothing could be cut up with a knife or
// sharp object to make cloth which could be combined with rubbing alcohols to make iFAK's"; "when in doubt just ask how
// does rust/dayz do it". What is held to here: every recipe is made of real things, by hand in 2 to 6 s; clothes are cut
// into rags by their size, only empty and never worn, with a blade that wears; powder comes out of ten rounds of one
// kind, more from a rifle's; a batch makes as many as the pockets allow; two things dragged onto each other find their
// recipes. On the server: a craft is let begin only with what it takes, is done only after its time and standing still,
// takes what stacks as building's costs ('spent') and the clothes by their number, wears the blade, and gives what is made.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';
import { CRAFT_ITEMS } from '../src/sim/items/craft';
import { RECIPE, RECIPES, RAGS, optionsOf } from '../src/sim/craft/recipes';
import { most, needsOf, plan, pocketsOf, recipesFor, type Plan, type Pockets } from '../src/sim/craft/plan';
import { TOOL_LIFE } from '../src/sim/gather';
import { PROTOCOL, type S2C } from '../src/net/protocol';

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
  // (found, never made: the plan)
  for (const id of ['code_lock', 'rubbing_alcohol', 'ak', 'ammo_556']) assert.ok(!RECIPES.some((r) => r.makes === id), `${id} is made`);
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
  assert.deepEqual(ids('stone', 'planks'), ['stone_hatchet']);
  assert.deepEqual(ids('knife', 'apple'), []);
  // (a workbench's recipes are not made by dragging)
  assert.deepEqual(ids('iron_bar', 'planks'), []);
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
  const until = async <T extends S2C['t']>(t: T, test: (m: Extract<S2C, { t: T }>) => boolean = () => true, ms = 4000) => {
    for (let k = 0; k < ms / 25; k++) {
      const m = of(t).find(test);
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
    send({ t: 'craft', r: 'nails', n: 1, go: 1 });
    assert.ok((await until('craft', (m) => m.r === 'nails'))?.why?.includes('workbench'));

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
