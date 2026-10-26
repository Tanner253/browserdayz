// The trader camp and the recyclers (src/sim/camp.ts, src/sim/jobs.ts, src/sim/craft/recyclers.ts; server/camp.ts,
// server/recycle.ts), of 2026-10-25, progression v3.
//   npx tsx test/camp.test.ts            the rules and the layers
//   npx tsx test/camp.test.ts --server   and a real server on a port of its own (8394), played over its socket
//
// What was asked (the owner's yes to plan v3): "a trader camp with four stalls ... Paid in scrap"; "Never overpowered: no
// top-tier gun, armour or steel plate on any shelf. A daily limit per player, and prices high enough that looting stays
// better"; "Jobs (three a day, as today) pay in scrap"; "Everyone's book credit is changed into scrap once"; a safe zone;
// "Recyclers: four ... plus one at the trader camp. Each is on its own layer ... A run takes a minute and is loud"; the
// navigator: "Server-checked, so nothing is minted"; "Sell prices low enough that the trader is a sink, not a farm".

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';
import { CAMP, STALLS, STALL_IDS, bookScrap, dayFor, leftToday, maySell, mayBuy, pays, payEach } from '../src/sim/camp';
import { dayOf, jobsFor, mayHandIn, progress } from '../src/sim/jobs';
import { RECYCLE, recycleStep, recyclable, recycles } from '../src/sim/craft/recyclers';
import { MAT } from '../src/sim/craft/materials';
import { PROTOCOL, type S2C, type StoredItem } from '../src/net/protocol';
import { buildWorldData } from '../server/world';
import { zonaDepth } from '../src/world/zona';
import { noBuilding } from '../src/sim/build/land';

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
const day0 = () => dayFor(dayOf(Date.now()), null);

console.log('The trader camp and the recyclers: the rules');

ok('four stalls, every good a real thing at a price in scrap, so many a day; no top-tier gun, armour or steel plate on any shelf', () => {
  assert.deepEqual(STALL_IDS, ['building', 'weapons', 'medical', 'clothing']);
  const top = ['deagle', 'benelli', 'sniper50', 'barrett', 'vssk', 'ar15', 'mp7a1', 'm32', 'ak', 'aks74u', 'a91', 'scope_50', 'scope_barrett', 'scope_vssk', 'elcan', 'armor_vest', 'heavy_armor', 'helmet_k63', 'steel_plate', 'keycard', 'dogtag', 'drum_ak', 'mag_ar_60'];
  for (const s of STALL_IDS) {
    assert.ok(STALLS[s].sells.length >= 5, `${s} sells ${STALLS[s].sells.length} things`);
    for (const g of STALLS[s].sells) {
      assert.ok(ITEMS[g.id], `${g.id} is not an item`);
      assert.ok(g.price > 0 && g.n > 0 && (g.day === undefined || g.day > 0), `${g.id}: ${JSON.stringify(g)}`);
      assert.ok(!top.includes(g.id), `${s} sells ${g.id}`);
    }
  }
  // (nails are dear: the owner, "they must be looted which is hard and time consuming")
  const nails = STALLS.building.sells.find((g) => g.id === 'nails')!;
  assert.ok(nails.price / nails.n >= 4 && (nails.day ?? 99) <= 3, 'nails are cheap');
});

ok('nothing bought is sold back for a profit, at any stall, nor recycled for more scrap than it cost', () => {
  for (const s of STALL_IDS) for (const g of STALLS[s].sells) {
    const it = makeItem(g.id, g.n);
    for (const t of STALL_IDS) assert.ok(pays(t, it) <= g.price * CAMP.backOfPrice + 1, `${g.id} bought at ${s} for ${g.price} sells at ${t} for ${pays(t, it)}`);
    const back = recycles(g.id, () => 0).filter(([id]) => id === MAT.scrap).reduce((k, [, q]) => k + q, 0) * g.n;
    assert.ok(back < g.price, `${g.id} recycles into ${back} scrap and costs ${g.price}`);
  }
  for (const s of STALL_IDS) for (const id of ['dogtag', 'keycard', MAT.scrap]) assert.equal(payEach(s, id), 0, `${s} buys ${id}`);
});

ok('a day: so many sales of a thing, scrap enough or not, and a most of scrap paid out for things sold', () => {
  const d = day0(), good = STALLS.weapons.sells.find((g) => g.id === 'colt')!;
  assert.equal(typeof mayBuy('weapons', 'colt', d, good.price - 1), 'string', 'a pistol bought with too little scrap');
  assert.equal(mayBuy('weapons', 'colt', d, good.price), good);
  d.bought.colt = good.day!;
  assert.equal(leftToday(good, d), 0);
  assert.match(mayBuy('weapons', 'colt', d, 9999) as string, /tomorrow/);
  assert.match(mayBuy('medical', 'colt', d, 9999) as string, /not sell/, 'the medical stall sold a pistol');
  const ak = makeItem('ak');
  assert.ok((maySell('weapons', ak, d) as number) > 0);
  assert.match(maySell('medical', ak, d) as string, /another stall/);
  d.sold = CAMP.soldADay - 3;
  assert.equal(maySell('weapons', ak, d), 3, 'the day\'s most was not kept to');
  d.sold = CAMP.soldADay;
  assert.match(maySell('weapons', ak, d) as string, /paid out/);
  // (yesterday is a clean page)
  assert.deepEqual(dayFor(d.day + 1, d).bought, {});
});

ok('three jobs a day, paid in scrap; the infected counted, a thing brought taken; handed in once', () => {
  const d = day0(), jobs = jobsFor(d.day);
  assert.equal(jobs.length, 3);
  for (const j of jobs) assert.ok(j.pays >= 5, `${j.id} pays ${j.pays}`);
  const first = jobs[0];
  assert.match(mayHandIn(first.id, d, () => 0) as string, /Not yet/);
  d.kills = d.heads = 99;
  assert.deepEqual(mayHandIn(first.id, d, () => 0), first);
  d.done.push(first.id);
  assert.match(mayHandIn(first.id, d, () => 0) as string, /settled/);
  assert.equal(progress(jobs[1], d, () => 99), jobs[1].n);
});

ok('the old book is paid out at a scrap for two credit, and no more than its most', () => {
  assert.equal(bookScrap(0), 0);
  assert.equal(bookScrap(101), 50);
  assert.equal(bookScrap(1e9), CAMP.book.most);
  assert.equal(bookScrap(-5), 0);
});

ok('a recycler breaks a thing at a time into fragments and scrap, never the metals, nails or tags, and stops when done', () => {
  for (const id of [MAT.scrap, MAT.frags, MAT.bar, 'nails', 'dogtag', 'keycard', 'gunpowder']) assert.deepEqual(recycles(id), [], `${id} goes through`);
  for (const id of ['metal_pipe', 'spring', 'gun_body_pistol', 'gun_body_rifle']) assert.ok(recycles(id).some(([x]) => x === MAT.frags), `${id} gives no fragments`);
  assert.ok(recycles('barrett', () => 0).some(([x]) => x === MAT.frags), 'a found gun gives no fragments');
  // (a gun that is crafted gives back half of what it is made of: Rust's)
  assert.deepEqual(recycles('ak', () => 1).find(([x]) => x === MAT.bar), [MAT.bar, 6]);
  assert.ok(recycles('field_jacket').some(([x]) => x === 'rags'), 'a jacket gives no rags');
  const items: StoredItem[] = [{ ...makeItem('spring', 1), x: 0, y: 0, rot: false }, { ...makeItem('nails', 20), x: 1, y: 0, rot: false }];
  const run = { on: true, done: 0 };
  let t = 0;
  for (; t < RECYCLE.each * 3 && run.on; t++) recycleStep(run, items, 1);
  assert.ok(!run.on, 'it ran on with nothing to break');
  assert.ok(!items.some((it) => it.id === 'spring'), 'the spring is still in it');
  assert.equal(items.find((it) => it.id === 'nails')?.qty, 20, 'the nails went through');
  assert.ok(items.some((it) => it.id === MAT.frags) && items.some((it) => it.id === MAT.scrap));
  assert.ok(!recyclable({ ...makeItem('sack_pack'), cargo: [{ item: makeItem('beans'), x: 0, y: 0, rot: false }] } as ItemInstance), 'a pack with things in it goes through');
});

const data = buildWorldData(process.cwd());
ok('the traders spread over the green west and the valley: a stall at each of four spots, out of the Zona, the desert and the mountain, apart; a safe zone and no base round each', () => {
  const c = data.camp!;
  assert.ok(c, 'no camp');
  assert.deepEqual(c.stalls.map((s) => s.id), ['building', 'weapons', 'medical', 'clothing']);
  // (the owner: "the trader zone must be moved from the red zone"; "the traders should be spread out across the map (green west and the valley only)")
  for (const q of c.spots) {
    assert.ok(zonaDepth(q.x, q.z) < -(CAMP.safe + 30), `the ${q.id} trader is ${(-zonaDepth(q.x, q.z)).toFixed(0)} m from the Zona`);
    assert.ok(q.x > -1950 && !(q.x > 250 && q.z < -150), `the ${q.id} trader is in the desert or on the mountain`);
    assert.equal(noBuilding(q.x + CAMP.safe, q.z, [], []), 'Too near a trader');
    const s = c.stalls.find((t) => t.id === q.id)!;
    assert.ok(Math.hypot(s.x - q.x, s.z - q.z) < CAMP.safe - 5, `the ${q.id} stall is laid past its safe zone`);
  }
  for (let i = 0; i < c.spots.length; i++) for (let j = i + 1; j < c.spots.length; j++) assert.ok(Math.hypot(c.spots[i].x - c.spots[j].x, c.spots[i].z - c.spots[j].z) > 300, 'two traders close together');
  assert.deepEqual(data.recyclers.slice(0, 4).map((r) => r.at), ['Zavod', 'the army camp', 'the fort', 'the chemical works']);
  assert.ok(c.recyclers.length >= 2, `a recycler at only ${c.recyclers.length} traders`);
  // (the same for the game: the layers are the world's, laid the same each time)
  const again = buildWorldData(process.cwd());
  assert.deepEqual(again.recyclers, data.recyclers);
  assert.deepEqual(again.camp, data.camp);
  console.log(`      traders at ${c.spots.map((q) => `${q.id} ${q.x},${q.z}`).join('; ')}; recyclers at ${data.recyclers.map((r) => `${r.at} ${r.x.toFixed(0)},${r.z.toFixed(0)}`).join('; ')}`);
});

if (process.argv.includes('--server')) await serverTest();
if (failed.length) {
  console.error(`CAMP TEST FAILED: ${failed.length} of ${n + failed.length}: ${failed.join('; ')}`);
  process.exit(1);
}
console.log(`CAMP TEST PASSED (${n})`);
process.exit(0);

async function serverTest() {
  const PORT = 8394, SITE = 'http://127.0.0.1:9';
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting a server');
  console.log('The camp: on a server (port 8394)');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-camp-'));
  const server = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '0', LOCAL_ADMIN: '1', INFECTED: 'off', ANIMALS: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logged = '';
  server.stdout!.on('data', (d) => (logged += d));
  server.stderr!.on('data', (d) => (logged += d));
  const join = async (key: string, name: string) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise<void>((done, fail) => {
      s.once('open', () => done());
      s.once('error', fail);
    });
    const got: S2C[] = [];
    s.on('message', (d) => got.push(JSON.parse(String(d)) as S2C));
    const send = (m: unknown) => s.send(JSON.stringify(m));
    send({ t: 'hello', v: PROTOCOL, key: key.padEnd(40, '0'), name, fp: `fp-${name}`.padEnd(64, 'a') });
    return { s, got, send };
  };
  let fail: unknown = null;
  const socks: WebSocket[] = [];
  try {
    for (let k = 0; k < 1500 && !logged.includes('listening'); k++) await sleep(100);
    assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-800)}`);
    const a = await join('camp-test-a-', 'Buyer'), b = await join('camp-test-b-', 'Shooter');
    socks.push(a.s, b.s);
    const until = async <T extends S2C['t']>(p: { got: S2C[] }, t: T, test: (m: Extract<S2C, { t: T }>) => boolean = () => true, ms = 5000, from = 0) => {
      for (let k = 0; k < ms / 25; k++) {
        const m = (p.got.slice(from).filter((q) => q.t === t) as Extract<S2C, { t: T }>[]).find(test);
        if (m) return m;
        await sleep(25);
      }
      return null;
    };
    for (const p of [a, b]) assert.ok(await until(p, 'welcome', () => true, 15000), 'not let in');
    assert.ok(await until(a, 'tday'), 'the day at the camp was not told on joining');
    const kit = async (p: typeof a, text: string) => {
      const had = p.got.filter((m) => m.t === 'kit').length;
      p.send({ t: 'chat', text });
      for (let k = 0; k < 160 && p.got.filter((m) => m.t === 'kit').length === had; k++) await sleep(25);
      return (p.got.filter((m) => m.t === 'kit')[had] as Extract<S2C, { t: 'kit' }> | undefined)?.items ?? [];
    };
    const tp = async (p: typeof a, x: number, z: number) => {
      const had = p.got.filter((m) => m.t === 'put').length;
      p.send({ t: 'chat', text: `/tp ${x.toFixed(2)} ${z.toFixed(2)}` });
      for (let k = 0; k < 160 && p.got.filter((m) => m.t === 'put').length === had; k++) await sleep(25);
      p.send({ t: 's', p: [x, data.groundAt(x, z), z, 0, 0, 0], w: null, m: [] });
      await sleep(80);
    };
    const me = (p: typeof a, items: ItemInstance[]) => p.send({ t: 'me', inv: { slots: {}, active: null, containers: [{ id: 'gear', items: items.map((it, i) => ({ ...it, x: (i * 3) % 12, y: Math.floor(i / 4) * 6, rot: false })) }] }, vitals: { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false }, sp: Math.max(0, ...p.got.filter((m) => m.t === 'spent').map((m) => (m as { n: number }).n)) });

    // at the weapons stall's counter: a pistol bought for its scrap; the scrap taken as building's costs are, the pistol issued
    const camp = data.camp!, w = camp.stalls.find((s) => s.id === 'weapons')!;
    const sp = camp.spots.find((q) => q.id === 'weapons')!;
    const scrap = await kit(a, '/give scrap 400');
    me(a, scrap);
    await tp(a, w.at[0] + Math.sin(w.rot) * 1.6, w.at[2] + Math.cos(w.rot) * 1.6);
    const g0 = a.got.length;
    a.send({ t: 'trade', s: 'weapons', op: 'buy', id: 'colt' });
    const bought = await until(a, 'trade', () => true, 5000, g0);
    assert.ok(bought?.ok, `the pistol was not sold: ${JSON.stringify(bought)}`);
    assert.ok(await until(a, 'spent', (m) => m.items.some(([id, k]) => id === MAT.scrap && k === STALLS.weapons.sells.find((x) => x.id === 'colt')!.price), 5000, g0), 'its scrap was not taken');
    const colt = (await until(a, 'kit', (m) => m.items.some((it) => it.id === 'colt'), 5000, g0))?.items.find((it) => it.id === 'colt');
    assert.ok(colt, 'the pistol was not given');
    assert.ok(await until(a, 'tday', (m) => m.day.bought.colt === 1, 5000, g0), 'the day did not count it');
    // (a second today: refused)
    a.send({ t: 'trade', s: 'weapons', op: 'buy', id: 'colt' });
    assert.ok(await until(a, 'trade', (m) => !m.ok && /tomorrow/.test(m.say), 5000, g0), 'a second pistol was sold today');
    console.log('  ok  a pistol bought at the weapons stall: its scrap taken, the pistol given, the day counting it; no second today');

    // sold back: by its number, for a little scrap
    me(a, [colt!, makeItem(MAT.scrap, 400 - STALLS.weapons.sells.find((x) => x.id === 'colt')!.price)]);
    await sleep(120);
    const g1 = a.got.length;
    a.send({ t: 'trade', s: 'weapons', op: 'sell', u: colt!.uid });
    const sold = await until(a, 'trade', () => true, 5000, g1);
    assert.ok(sold?.ok && sold.used?.[0] === colt!.uid, `not sold back: ${JSON.stringify(sold)}`);
    const back = (await until(a, 'kit', (m) => m.items.some((it) => it.id === MAT.scrap), 5000, g1))?.items.find((it) => it.id === MAT.scrap);
    assert.ok(back && back.qty < 20, `paid ${back?.qty} scrap for a pistol it sold for ${STALLS.weapons.sells.find((x) => x.id === 'colt')!.price}`);
    // (from far off: not believed)
    await tp(a, sp.x + 60, sp.z);
    const g2 = a.got.length;
    a.send({ t: 'trade', s: 'weapons', op: 'buy', id: 'ammo_9mm' });
    assert.ok(await until(a, 'trade', (m) => !m.ok && /counter/.test(m.say), 5000, g2), 'a trade from 60 m off was let through');
    console.log(`  ok  sold back by its number for ${back!.qty} scrap; nothing traded from away from the counter`);

    // the old book: paid out once
    const g3 = a.got.length;
    a.send({ t: 'book', n: 300 });
    assert.ok(await until(a, 'kit', (m) => m.items.some((it) => it.id === MAT.scrap && it.qty === 150), 5000, g3), 'the old book was not paid out');
    a.send({ t: 'book', n: 300 });
    await sleep(400);
    assert.equal(a.got.slice(g3).filter((m) => m.t === 'kit').length, 1, 'the old book was paid out twice');
    console.log('  ok  the old book paid out once, at a scrap for two credit');

    // the safe zone: a punch out on the meadow lands; the same at the camp hurts nobody
    const pa = a.got.filter((m) => m.t === 'welcome')[0] as { you: number };
    const punch = () => b.send({ t: 'hit', to: pa.you, w: 'fists', zone: 'torso', dist: 1, sup: false, bonus: 0 });
    await tp(a, sp.x + CAMP.safe + 30.6, sp.z);
    await tp(b, sp.x + CAMP.safe + 30, sp.z);
    const g4 = b.got.length;
    punch();
    assert.ok(await until(b, 'hitok', () => true, 3000, g4), 'a punch out on the meadow did not land (the check of the safe zone proves nothing)');
    await tp(a, sp.x + 0.6, sp.z);
    await tp(b, sp.x, sp.z);
    await sleep(1200);
    const g5h = b.got.length;
    punch();
    await sleep(600);
    assert.equal(b.got.slice(g5h).filter((m) => m.t === 'hitok').length, 0, 'a punch at the camp hurt somebody');
    console.log('  ok  a punch lands on the meadow, and nobody is hurt at a trader');

    // a recycler: a spring in it, switched on, broken down into fragments and scrap, and switched itself off
    const r = data.recyclers.findIndex((q) => q.at.endsWith('trader')), R = data.recyclers[r];
    await tp(a, R.x + Math.sin(R.rot) * 1.8, R.z + Math.cos(R.rot) * 1.8);
    const cid = `recy:${r}`, g5 = a.got.length;
    a.send({ t: 'copen', cid });
    assert.ok(await until(a, 'cdata', (m) => m.cid === cid, 5000, g5), 'the recycler did not open');
    a.send({ t: 'cset', cid, items: [{ ...makeItem('spring', 1), x: 0, y: 0, rot: false }] });
    await sleep(200);
    a.send({ t: 'recy', i: r, on: true });
    assert.ok(await until(a, 'recy', (m) => m.i === r && m.on, 5000, g5), 'it did not start');
    assert.ok(await until(b, 'recy', (m) => m.i === r && m.on, 5000), 'somebody else was not told it runs');
    const out = await until(a, 'cdata', (m) => m.cid === cid && m.items.some((it) => it.id === MAT.frags), (RECYCLE.each + 4) * 1000, g5);
    assert.ok(out && !out.items.some((it) => it.id === 'spring'), `the spring was not broken down: ${JSON.stringify(out?.items)}`);
    assert.ok(await until(a, 'recy', (m) => m.i === r && !m.on, 5000, g5), 'it did not stop with nothing left');
    console.log('  ok  a recycler broke a spring into fragments and scrap, everybody told it ran, and it stopped itself');
  } catch (e) {
    fail = e;
  } finally {
    for (const s of socks) s.close();
    if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    await sleep(300);
    rmSync(dir, { recursive: true, force: true });
  }
  if (fail) {
    failed.push('the server');
    console.log(`  NOT OK  the server: ${fail instanceof Error ? fail.message : fail}\n--- server log tail ---\n${logged.slice(-1500)}`);
  } else n++;
}
