// Gathering, base building's first step (src/sim/gather.ts, server/gather.ts, src/game/gathering.ts), of 2026-10-24.
//   npx tsx test/gather.test.ts            the rules, the things and the map's loot: about half a minute
//   npx tsx test/gather.test.ts --server   and a real server on a port of its own (8391), played over its socket
//
// What was asked: "players will need to harvest trees for logs and then saw them for planks and harvest nails from
// industrial areas etc.. and need a hatchet to hammer nails in or deconstruct"; "tools need durability now... like
// dayz"; "we need maintenence requirements and materials gathering ... must grind to have a big base".
//
// What is held to here: a tree takes its blows and falls into its logs, a felling axe in fewer of them; a half-cut tree
// heals when it is left; a felled tree stands again only when its time is up and nobody is near; a boulder gives its
// stone a blow at a time and is spent, and has stone again later; small rocks and cliffs give none; a saw makes six
// planks of a log; every use wears the tool and a ruined one does no work; nails, sheet metal, planks and the new
// tools are found where DayZ keeps them. On the server: blows are believed only with the tool in the hands, near
// enough and no faster than it swings; the tree falls for everybody and its logs lie along where it fell; a player who
// comes in afterwards finds it down; stone and planks come into the pockets; sawing takes its time; and a game that
// says its tool is newer than the server wore it is not believed.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { CHOPS, MINES, ROCK, SAW, SAWS, TOOL_LIFE, TREE, TREE_KINDS, Woods, condition, rockOf, treeOf, worn } from '../src/sim/gather';
import { ITEMS, itemWeight, makeItem, sanitizeItem, type ItemInstance } from '../src/sim/items';
import { Economy } from '../src/sim/economy';
import { RNG } from '../src/core/noise';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { buildWorldData } from '../server/world';
import type { Instance } from '../src/world/worldgen';

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

console.log('Gathering: the rules');
const tree = (kind: string, scale = 1): Instance => ({ kind, x: 0, y: 0, z: 0, rot: 0, scale });

ok('every kind of tree that is felled takes 10 to 30 hatchet blows and falls into 2 to 5 logs; a bush is never felled', () => {
  for (const kind of Object.keys(TREE_KINDS)) {
    for (const scale of [0.85, 1, 1.2]) {
      const k = treeOf(tree(kind, scale))!;
      assert.ok(k.blows >= 10 && k.blows <= 30, `${kind} at ${scale}: ${k.blows} blows`);
      assert.ok(k.logs >= 2 && k.logs <= 5, `${kind} at ${scale}: ${k.logs} logs`);
    }
  }
  assert.equal(treeOf(tree('bush_a')), null);
  assert.equal(treeOf(tree('boulder_01')), null);
  // (a big pine is more work than a birch, and gives more)
  assert.ok(treeOf(tree('pine_c'))!.blows > treeOf(tree('birch_a'))!.blows && treeOf(tree('pine_c'))!.logs > treeOf(tree('birch_a'))!.logs);
});

ok('a tree falls on its last blow, never before; a felling axe fells it in well under half the blows', () => {
  const t = tree('pine_a'), w = new Woods([t], []), k = treeOf(t)!;
  for (let b = 1; b < k.blows; b++) {
    const r = w.chop(0, CHOPS.hatchet, 1000 + b);
    assert.ok(r && !r.fell, `fell at blow ${b} of ${k.blows}`);
  }
  const last = w.chop(0, CHOPS.hatchet, 5000)!;
  assert.ok(last.fell && last.logs === k.logs);
  assert.equal(w.chop(0, CHOPS.hatchet, 6000), null, 'a felled tree took another blow');
  const w2 = new Woods([t], []);
  let blows = 0;
  while (!w2.chop(0, CHOPS.felling_axe, 1000 + blows)!.fell) blows++;
  assert.ok(blows + 1 <= Math.ceil(k.blows / 2.4), `a felling axe took ${blows + 1} blows against a hatchet's ${k.blows}`);
});

ok(`a half-cut tree heals when nobody comes back to it in ${TREE.heal / 60000} minutes`, () => {
  const t = tree('pine_a'), w = new Woods([t], []), k = treeOf(t)!;
  for (let b = 0; b < k.blows - 1; b++) w.chop(0, 1, 1000);
  const r = w.chop(0, 1, 1000 + TREE.heal + 1)!;
  assert.ok(!r.fell && Math.abs(r.left - (k.blows - 1)) < 1e-9, `left ${r.left} after healing`);
});

ok(`a felled tree stands again after ${TREE.regrow / 3600000} h, and not while anybody is within ${TREE.unseen} m of it`, () => {
  const t = tree('birch_a'), w = new Woods([t], []), k = treeOf(t)!;
  for (let b = 0; b < k.blows; b++) w.chop(0, 1, 1000);
  assert.ok(w.felled.has(0));
  assert.deepEqual(w.regrow(1000 + TREE.regrow - 1, () => false), [], 'grew back early');
  assert.deepEqual(w.regrow(1000 + TREE.regrow + 1, (x, z, within) => within >= TREE.unseen), [], 'grew back in sight of somebody');
  assert.deepEqual(w.regrow(1000 + TREE.regrow + 1, () => false), [0]);
  assert.ok(!w.felled.has(0) && w.chop(0, 1, 2e7) !== null, 'it cannot be felled again');
});

ok('only boulders and the moss-grown rock sets a man\'s height and up give stone; cliffs and pebbles none', () => {
  assert.ok(rockOf(tree('boulder_01', 1)) > 0);
  assert.ok(rockOf(tree('rock_moss_set_01#3', 1.2)) > 0, 'a rock set by its numbered kind');
  assert.equal(rockOf(tree('boulder_01', 0.6)), 0);
  assert.equal(rockOf(tree('rock_face_01', 2)), 0);
  assert.ok(rockOf(tree('boulder_01', 2)) > rockOf(tree('boulder_01', 1)), 'a big boulder gives more');
});

ok(`a boulder gives ${ROCK.perBlow} stone a blow until it is spent, then nothing until ${ROCK.refill / 3600000} h later`, () => {
  const r = tree('boulder_01', 1.2), w = new Woods([], [r]), all = rockOf(r);
  let got = 0, blows = 0;
  for (;;) {
    const m = w.mine(0, MINES.pickaxe, 1000)!;
    if (!m.give) break;
    assert.equal(m.give, ROCK.perBlow);
    got += m.give;
    blows++;
    assert.ok(blows < 100);
  }
  assert.equal(got, all);
  assert.ok(w.spent(0, 2000));
  assert.deepEqual(w.mine(0, 1, 1000 + ROCK.refill - 1), { give: 0, done: 1 });
  assert.equal(w.mine(0, 1, 1000 + ROCK.refill + 1)!.give, ROCK.perBlow, 'no stone again after its time');
  assert.equal(new Woods([], [tree('rock_face_01', 2)]).mine(0, 1, 0), null);
  console.log(`      a boulder at 1.2: ${all} stone in ${blows} blows (~${Math.round(blows * ITEMS.pickaxe.melee!.rate)} s)`);
});

ok('every tool wears a step a use and is ruined at the end of its life; DayZ\'s five states by condition', () => {
  for (const id of Object.keys(TOOL_LIFE)) {
    assert.ok(ITEMS[id]?.melee, `${id} is not a thing to hold and swing`);
    let c: number | undefined;
    for (let u = 0; u < TOOL_LIFE[id] - 1; u++) c = worn(id, c);
    assert.ok(c! > 0 && !condition(c).ruined, `${id} ruined early at ${c}`);
    c = worn(id, c);
    assert.ok(c <= 0.003, `${id} still at ${c} after its ${TOOL_LIFE[id]} uses`);
    assert.ok(condition(worn(id, c)).ruined && worn(id, 0) === 0);
  }
  assert.deepEqual([1, 0.8, 0.6, 0.4, 0.2, 0].map((c) => condition(c).name), ['Pristine', 'Pristine', 'Worn', 'Damaged', 'Badly damaged', 'Ruined']);
  assert.equal(condition(undefined).name, 'Pristine');
});

ok('a tool\'s condition travels with it: kept between ruined and new, and not said when new', () => {
  const it = (cond: unknown) => sanitizeItem({ ...makeItem('hatchet'), cond } as ItemInstance)!;
  assert.equal(it(0.5).cond, 0.5);
  assert.equal(it(-3).cond, 0);
  assert.equal(it(1).cond, undefined);
  assert.equal(it(7).cond, undefined);
  assert.equal(it('x').cond, undefined);
});

ok('the things: logs heavy and long, planks and stone stacking, nails and sheet metal found; the tools in the hands', () => {
  for (const id of ['log', 'planks', 'stone', 'nails', 'sheet_metal', 'hand_saw', 'felling_axe', 'pickaxe']) assert.ok(ITEMS[id], `no ${id}`);
  assert.ok(ITEMS.log.weight >= 5 && ITEMS.log.h >= 6 && !ITEMS.log.stack);
  assert.equal(itemWeight(makeItem('planks', 20)), 6);
  assert.ok(Math.abs(itemWeight(makeItem('stone', 50)) - 7.5) < 1e-9);
  assert.ok(ITEMS.nails.stack! >= 99 && ITEMS.sheet_metal.stack! >= 5);
  assert.ok(CHOPS.hatchet && CHOPS.felling_axe > CHOPS.hatchet && MINES.pickaxe && SAWS.hand_saw);
  assert.equal(SAW.planks, 6);
  assert.ok(!ITEMS.log.loot && !ITEMS.stone.loot, 'logs and stone are got, never found');
});

console.log('Gathering: where the things are found');
const data = buildWorldData(process.cwd());
ok('nails, sheet metal, planks and the three new tools lie on the map, in sheds and the industrial places', () => {
  const counts: Record<string, number> = {};
  const where: Record<string, Set<string>> = {};
  for (const seed of [11, 2026]) {
    const e = new Economy(data.lootPoints, { spawn: () => {}, despawn: () => {} });
    (e as unknown as { rng: RNG }).rng = new RNG(seed);
    e.populate();
    for (const l of e.loot.values()) {
      const id = l.item.id;
      if (!['nails', 'sheet_metal', 'planks', 'hand_saw', 'felling_axe', 'pickaxe'].includes(id)) continue;
      counts[id] = (counts[id] ?? 0) + 1;
      for (const u of data.lootPoints[l.point]?.usage ?? []) (where[id] ??= new Set()).add(u);
    }
  }
  for (const id of ['nails', 'sheet_metal', 'planks', 'hand_saw', 'felling_axe', 'pickaxe']) assert.ok((counts[id] ?? 0) >= 4, `${id}: ${counts[id] ?? 0} over two stockings`);
  assert.ok(where.nails.has('Industrial') && where.sheet_metal.has('Industrial'), 'none where things were made');
  for (const id of ['sheet_metal']) assert.ok(![...where[id]].some((u) => u === 'Town' || u === 'Shop'), `${id} in a ${[...where[id]]}`);
  console.log(`      two stockings: ${Object.entries(counts).map(([id, c]) => `${id} ${c / 2}`).join(', ')}`);
});

ok('the map has trees to fell and boulders to break near every part of it', () => {
  const felled = data.trees.filter((t) => treeOf(t)).length, rocks = data.rocks.filter((r) => rockOf(r)).length;
  assert.ok(felled > 5000, `${felled} trees`);
  assert.ok(rocks > 300, `${rocks} boulders`);
  console.log(`      ${felled} trees to fell, ${rocks} boulders to break`);
});

// ---------------------------------------------------------------- the server
if (process.argv.includes('--server')) await serverTest();
if (failed.length) {
  console.error(`GATHER TEST FAILED: ${failed.length} of ${n + failed.length}: ${failed.join('; ')}`);
  process.exit(1);
}
console.log(`GATHER TEST PASSED (${n})`);
process.exit(0);

async function serverTest() {
  const PORT = 8391, SITE = 'http://127.0.0.1:9';
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting a server');
  console.log('Gathering: on a server (port 8391)');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-gather-'));
  const server = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '0', LOCAL_ADMIN: '1', INFECTED: 'off', ANIMALS: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logged = '';
  server.stdout!.on('data', (d) => (logged += d));
  server.stderr!.on('data', (d) => (logged += d));

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
      this.send({ t: 'hello', v: PROTOCOL, key: `gather-test-key-${this.name}-`.padEnd(40, '0'), name: this.name, fp: `fp-${this.name}`.padEnd(64, 'a') });
      for (let k = 0; k < 300 && !this.of('welcome').length; k++) await sleep(50);
      assert.ok(this.of('welcome').length, `${this.name} was not let in: ${JSON.stringify(this.got).slice(0, 300)}`);
    }
    send(m: unknown) {
      this.ws.send(JSON.stringify(m));
    }
    of<T extends S2C['t']>(t: T) {
      return this.got.filter((m) => m.t === t) as Extract<S2C, { t: T }>[];
    }
    async until<T extends S2C['t']>(t: T, test: (m: Extract<S2C, { t: T }>) => boolean = () => true, ms = 4000) {
      for (let k = 0; k < ms / 25; k++) {
        const m = this.of(t).find(test);
        if (m) return m;
        await sleep(25);
      }
      return null;
    }
    /** an admin's word typed in the chat */
    say(text: string) {
      this.send({ t: 'chat', text });
    }
    /** a thing given by /give, and kept in this game's pockets (said to the server as its 'me') */
    async give(id: string) {
      const had = this.of('kit').length;
      this.say(`/give ${id}`);
      for (let k = 0; k < 160 && this.of('kit').length === had; k++) await sleep(25);
      const it = this.of('kit')[had]?.items[0];
      assert.ok(it?.id === id, `/give ${id} gave ${JSON.stringify(it)}`);
      this.pockets.push(it);
      this.me();
      return it;
    }
    me() {
      this.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'gear', items: this.pockets.map((it, i) => ({ ...it, x: (i * 3) % 12, y: Math.floor(i / 4) * 6, rot: false })) }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false } });
    }
    async go(x: number, z: number) {
      const had = this.of('put').length;
      this.say(`/tp ${x.toFixed(2)} ${z.toFixed(2)}`);
      for (let k = 0; k < 160 && this.of('put').length === had; k++) await sleep(25);
      this.pos = [x, data.groundAt(x, z), z];
      this.pose();
      await sleep(60);
    }
    pose() {
      this.send({ t: 's', p: [this.pos[0], this.pos[1], this.pos[2], 0, 0, 0], w: this.held, m: [] });
    }
    hold(id: string | null) {
      this.held = id;
      this.pose();
    }
  }

  const gap = (id: string) => ITEMS[id].melee!.rate * 1000 + 30;
  let fail: unknown = null;
  try {
    for (let k = 0; k < 1500 && !logged.includes('listening'); k++) await sleep(100);
    assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
    const a = new Player('Logger');
    await a.join();
    assert.deepEqual(a.of('welcome')[0].felled, [], 'a fresh server has trees down');
    const t = data.trees.findIndex((q, i) => q.kind === 'pine_a' && Math.abs(q.x) < 600 && Math.abs(q.z) < 600 && data.trees.every((o, j) => j === i || Math.hypot(o.x - q.x, o.z - q.z) > 3));
    const T = data.trees[t], k = treeOf(T)!;
    const axe = await a.give('hatchet');
    await a.go(T.x - 1.4, T.z);
    a.hold('hatchet');

    // a blow with nothing in the hands, too far off, or too soon, is not believed
    a.hold(null);
    a.send({ t: 'chop', i: t, u: axe.uid });
    await sleep(250);
    assert.equal(a.of('work').length, 0, 'a blow with empty hands was believed');
    a.hold('hatchet');
    a.send({ t: 'chop', i: t + 1, u: axe.uid });
    await sleep(250);
    assert.equal(a.of('work').length, 0, 'a blow at a tree out of reach was believed');
    a.send({ t: 'chop', i: t, u: axe.uid });
    a.send({ t: 'chop', i: t, u: axe.uid });
    await sleep(300);
    assert.equal(a.of('work').length, 1, `two blows at once were both believed (${a.of('work').length})`);
    console.log('  ok  a blow is believed only with the tool in the hands, near enough, and no faster than it swings');

    // the rest of its blows: it wears a step each time, and falls on the last
    for (let b = 1; b < k.blows; b++) {
      await sleep(gap('hatchet'));
      a.send({ t: 'chop', i: t, u: axe.uid });
    }
    const fell = await a.until('fell', (m) => m.i === t);
    assert.ok(fell, `the tree did not fall after ${k.blows} blows: ${JSON.stringify(a.of('work').slice(-2))}`);
    assert.ok(Math.abs(fell.a - Math.atan2(1.4, 0)) < 0.2, `it fell toward ${fell.a}, not away from the axe`);
    const wears = a.of('wear').filter((m) => m.u === axe.uid);
    assert.equal(wears.length, k.blows, `${wears.length} wear for ${k.blows} blows`);
    assert.ok(Math.abs(wears[wears.length - 1].c - (1 - k.blows / TOOL_LIFE.hatchet)) < 0.003, `worn to ${wears[wears.length - 1].c}`);
    await sleep(200);
    assert.equal(a.of('loot+').filter((m) => m.l.item.id === 'log').length, 0, 'the logs lay under the tree as it fell');
    await sleep(TREE.lands);
    const logs = a.of('loot+').filter((m) => m.l.item.id === 'log');
    assert.equal(logs.length, k.logs, `${logs.length} logs lie by it, of ${k.logs}`);
    for (const l of logs) assert.ok(Math.hypot(l.l.x - T.x, l.l.z - T.z) < 14 && l.l.x > T.x - 0.5, `a log at ${l.l.x.toFixed(1)}, ${l.l.z.toFixed(1)}: not along where it fell`);
    console.log(`  ok  the pine fell on its ${k.blows}th blow, away from the axe; ${k.logs} logs lie along it; the hatchet is worn to ${wears[wears.length - 1].c}`);

    // somebody who comes in now finds it down
    const b = new Player('Latecomer');
    await b.join();
    assert.ok(b.of('welcome')[0].felled?.includes(t), 'a player coming in afterwards finds the tree standing');
    a.send({ t: 'chop', i: t, u: axe.uid });
    await sleep(gap('hatchet'));
    console.log('  ok  a player who comes in afterwards finds it down');

    // a game that says its hatchet is new again is not believed: the next blow wears it on from where it was
    const was = wears[wears.length - 1].c;
    a.pockets[0] = { ...axe, cond: undefined } as ItemInstance;
    a.me();
    await sleep(150);
    const t2 = data.trees.findIndex((q, i) => i !== t && treeOf(q) && Math.hypot(q.x - T.x, q.z - T.z) < 25 && Math.hypot(q.x - T.x, q.z - T.z) > 4);
    const T2 = data.trees[t2];
    await a.go(T2.x - 1.2, T2.z);
    a.send({ t: 'chop', i: t2, u: axe.uid });
    const w2 = await a.until('wear', (m) => m.c < was);
    assert.ok(w2 && Math.abs(w2.c - worn('hatchet', was)) < 1e-6, `after saying it was new: worn to ${w2?.c}, it was ${was}`);
    console.log('  ok  a game that says its hatchet is new again is not believed');

    // ruined: no work
    a.pockets[0] = { ...axe, cond: 0 } as ItemInstance;
    a.me();
    await sleep(gap('hatchet'));
    const works = a.of('work').length;
    a.send({ t: 'chop', i: t2, u: axe.uid });
    const told = await a.until('tell', (m) => /ruined/.test(m.text));
    assert.ok(told && a.of('work').length === works, 'a ruined hatchet still worked');
    console.log('  ok  a ruined hatchet does no work, and says so');

    // stone: a pickaxe on a boulder, three at a time into the pockets, until it is spent
    const r = data.rocks.findIndex((q) => rockOf(q) && q.kind.startsWith('boulder') && Math.abs(q.x) < 900 && Math.abs(q.z) < 900);
    const R = data.rocks[r], all = rockOf(R);
    const pick = await a.give('pickaxe');
    await a.go(R.x - (1.2 + 0.9 * R.scale), R.z);
    a.hold('pickaxe');
    const kits = a.of('kit').length;
    for (let s = 0; s < all / ROCK.perBlow; s++) {
      a.send({ t: 'mine', i: r, u: pick.uid });
      await sleep(gap('pickaxe'));
    }
    await sleep(200);
    const stone = a.of('kit').slice(kits).flatMap((m) => m.items).filter((it) => it.id === 'stone');
    assert.equal(stone.reduce((s, it) => s + it.qty, 0), all, `${stone.length} gifts of stone`);
    a.send({ t: 'mine', i: r, u: pick.uid });
    assert.ok(await a.until('tell', (m) => /Nothing more breaks off/.test(m.text)), 'a spent rock said nothing');
    console.log(`  ok  a boulder gave its ${all} stone into the pockets, ${ROCK.perBlow} a blow, and was spent`);

    // a log sawn: begun, not done too soon, done after its time, six planks into the pockets and the log gone
    const saw = await a.give('hand_saw');
    const log = logs[0].l;
    await a.go(log.x - 1, log.z);
    a.hold('hand_saw');
    a.send({ t: 'saw', l: log.uid, u: saw.uid, go: 1 });
    assert.ok((await a.until('saw', (m) => m.l === log.uid))?.ok, 'sawing was not begun');
    a.send({ t: 'saw', l: log.uid, u: saw.uid, go: 2 });
    await sleep(300);
    assert.ok(!a.of('saw').some((m) => m.done), 'a log was sawn at once');
    a.send({ t: 'saw', l: log.uid, u: saw.uid, go: 1 });
    await sleep(SAW.time * 1000 + 100);
    const k0 = a.of('kit').length;
    a.send({ t: 'saw', l: log.uid, u: saw.uid, go: 2 });
    assert.ok(await a.until('saw', (m) => !!m.done), 'the sawing was never done');
    const planks = a.of('kit').slice(k0).flatMap((m) => m.items).find((it) => it.id === 'planks');
    assert.equal(planks?.qty, SAW.planks);
    assert.ok(await a.until('loot-', (m) => m.uid === log.uid), 'the log was not taken away');
    assert.ok(a.of('wear').some((m) => m.u === saw.uid && Math.abs(m.c - worn('hand_saw', 1)) < 1e-6), 'the saw did not wear');
    console.log(`  ok  a log is sawn in ${SAW.time} s into ${SAW.planks} planks, not at once; it is gone and the saw worn`);
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
