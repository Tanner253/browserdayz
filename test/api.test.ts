// The site's three addresses (api/cashin, api/tick, api/cashins) with the made-up chain
// behind them and a stand-in for the game server in front. `npx tsx test/api.test.ts`
// With a file name as argument, the payouts page as it comes out is also written there.

import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { record } from '../api/cashin';
import { tick } from '../api/tick';
import { show } from '../api/cashins';
import { config, readBook, type Entry } from '../api/_lib/payouts';
import { KEY, SOL, TREASURY, got, tag, wallet, world } from './fake';

// what the game server knows: it is asked for a cash-in by its id, and for nothing else
const known = new Map<string, Entry>();
const game = http.createServer((req, res) => {
  const id = (req.url ?? '').split('/')[2];
  const e = (req.url ?? '').startsWith('/cashins/') ? known.get(id) : undefined;
  res.writeHead(e ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(e ?? { error: 'unknown' }));
});
await new Promise<void>((r) => game.listen(0, '127.0.0.1', r));
const GAME = `http://127.0.0.1:${(game.address() as { port: number }).port}`;

let n = 0;
const test = async (name: string, fn: () => Promise<void>) => {
  await fn();
  n++;
  console.log('  ok  ' + name);
};
const call = async (w: ReturnType<typeof world>, id: string) => {
  const r = await record(new Request(`https://site.test/api/cashin?id=${id}`, { method: 'POST' }), w, GAME);
  return { status: r.status, body: (await r.json()) as { ok?: boolean; error?: string; payout?: { state: string; lamports?: number; signature?: string; why?: string } } };
};

const w = world(10.01);

await test('only what the game server vouches for is listed or paid', async () => {
  assert.equal((await call(w, 'nosuchcashin1')).status, 404);
  assert.equal((await call(w, 'x')).status, 400);
  assert.equal((await call(w, '../../etc/passwd')).status, 400);
  assert.equal(w.chain.handedIn.length, 0);
  assert.equal((await readBook(w.store)).rows.length, 0);
});

const first = tag(w, 1, { name: 'Sable', owner: 'Brick' });
await test('a tag reported by the game server is filed, paid, and answered for', async () => {
  known.set(first.id, first);
  const r = await call(w, first.id);
  assert.equal(r.status, 200);
  assert.equal(r.body.payout?.state, 'paid');
  assert.equal(r.body.payout?.lamports, Number(SOL(0.2)));
  assert.equal(got(w, 1), SOL(0.2));
  assert.equal([...w.store.files.keys()].filter((k) => k.startsWith('cashins/') && k.endsWith(`_${first.id}.json`)).length, 1);
});

await test('reported again: answered from the book, nothing sent; an id the game server does not know touches nothing', async () => {
  const sent = w.chain.handedIn.length, made = w.store.ops.create;
  assert.equal((await call(w, first.id)).body.payout?.state, 'paid');
  assert.equal(w.chain.handedIn.length, sent);
  assert.equal(w.store.ops.create, made);
  assert.equal(got(w, 1), SOL(0.2));
  // the game server has restarted and forgotten it: anybody calling with that id now is turned away at the door
  known.delete(first.id);
  const reads = w.store.ops.read;
  assert.equal((await call(w, first.id)).status, 404);
  assert.equal(w.store.ops.read, reads);
  assert.equal(got(w, 1), SOL(0.2));
});

await test('a tag with no wallet, a slow one, and the housekeeping that finishes it', async () => {
  const none = tag(w, '', { name: 'Nowallet' });
  known.set(none.id, none);
  assert.equal((await call(w, none.id)).body.payout?.state, 'skipped');
  w.chain.landAfter = 200;
  const slow = tag(w, 2, { name: 'Slowpoke' });
  known.set(slow.id, slow);
  assert.equal((await call(w, slow.id)).body.payout?.state, 'sending');
  w.skip(70_000);
  w.chain.landAfter = 2;
  const t = (await (await tick(new Request('https://site.test/api/tick'), w)).json()) as { tried: number; paid: number };
  assert.deepEqual([t.tried, t.paid], [1, 1]);
  assert.ok(got(w, 2) > 0n);
});

await test('tags from before there was a book are read into it once, as listed', async () => {
  w.store.files.set('cashins/2026-10-07T20-11-05-123Z_oldentry0001.json', { text: JSON.stringify({ id: 'oldentry0001', at: '2026-10-07T20:11:05.123Z', name: 'Early', owner: 'Bird', wallet: wallet(77) }), mark: 9999 });
  await show(new Request('https://site.test/payouts'), w);
  const lists = w.store.ops.list;
  await show(new Request('https://site.test/payouts'), w);
  assert.equal(w.store.ops.list, lists);
  const row = (await readBook(w.store)).rows.find((r) => r.id === 'oldentry0001');
  assert.equal(row?.state, 'off');
  // the housekeeping then settles it for good: not paid, and why
  await tick(new Request('https://site.test/api/tick'), w);
  assert.match((await readBook(w.store)).rows.find((r) => r.id === 'oldentry0001')?.why ?? '', /before automatic payouts began/);
  assert.equal(got(w, 77), 0n);
});

await test('the page, the data behind it, and what the game is told', async () => {
  w.chain.rewards = SOL(0.03);
  const html = await (await show(new Request('https://site.test/payouts'), w)).text();
  if (process.argv[2]) writeFileSync(process.argv[2], html);
  for (const want of ['Automatic payouts are on', 'SOL in the treasury', `${TREASURY.address.slice(0, 4)}…${TREASURY.address.slice(-4)}`, 'Sable', 'Brick', '0.2 SOL', 'https://solscan.io/tx/', 'none given', 'not paid: no wallet given', 'before automatic payouts began', '0.03 waiting to be collected']) assert.ok(html.includes(want), `the page does not say "${want}"`);
  // (nothing a player typed gets onto the page as markup, and no id or key is on it)
  const evil = tag(w, 3, { name: '<img src=x onerror=1>', owner: '"><script>' });
  known.set(evil.id, evil);
  await call(w, evil.id);
  const html2 = await (await show(new Request('https://site.test/payouts'), w)).text();
  assert.ok(!html2.includes('<img src=x') && !html2.includes('"><script>'));
  assert.ok(!html2.includes(first.id) && !html2.includes(KEY));
  const data = (await (await show(new Request('https://site.test/payouts?format=json'), w)).json()) as { status: { mode: string }; paid: number; rows: Record<string, unknown>[] };
  assert.equal(data.status.mode, 'on');
  assert.equal(data.paid, 3);
  assert.ok(data.rows.every((r) => !('id' in r)));
  assert.ok(!JSON.stringify(data).includes(KEY));
  const status = (await (await show(new Request('https://site.test/payouts?format=status'), w)).json()) as { on: boolean; tagPays: number; share: number; floor: number };
  assert.deepEqual([status.on, status.share, status.floor], [true, 0.02, 0.02]);
  assert.ok(status.tagPays > 0.18 && status.tagPays <= 0.2);
});

await test('switched off: listed, not paid, and the page says so', async () => {
  const off = world(1, { PAYOUTS: 'off' });
  const e = tag(off, 5);
  known.set(e.id, e);
  assert.equal((await call(off, e.id)).body.payout?.state, 'off');
  const html = await (await show(new Request('https://site.test/payouts'), off)).text();
  assert.ok(html.includes('Automatic payouts are off') && html.includes('listed (payouts were not on)'));
  // asked for with a key that is not the treasury's: off, and it says why, without the key
  off.cfg = config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: KEY, TREASURY_ADDRESS: wallet(9) });
  const bad = await (await show(new Request('https://site.test/payouts'), off)).text();
  assert.ok(bad.includes('could not start') && bad.includes('not the key of TREASURY_ADDRESS') && !bad.includes(KEY));
  assert.equal(off.chain.handedIn.length, 0);
});

game.close();
console.log(`${n} checks passed`);
