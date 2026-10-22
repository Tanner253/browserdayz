// npx tsx test/store.test.ts: the store's check of a payment (api/store.ts, api/_lib/shop.ts). A made-up chain first:
// a quote is found by its reference, by its exact amount, or by a pasted signature; each payment counts once; a short
// one waits for an admin, one under half or made before the quote is refused and not written; a payment is credited
// to the account its quote was sealed for, and nobody else's quote finds it; VIP stacks; an admin's orders. Then one
// real payment on mainnet, read and never sent: a past payout of 0.01 SOL, checked as if it had been a purchase.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { storeApi, type Deps } from '../api/store';
import { BOOK, paymentOf, rowId, sol, unseal, type Book } from '../api/_lib/shop';
import { Rpc, b58 } from '../api/_lib/solana';
import { MemoryStore } from '../api/_lib/store';
import { SHOP, type PerkList } from '../api/_lib/shop-items';

const WALLET = b58(new Uint8Array(32).fill(7)), PAYER = b58(new Uint8Array(32).fill(9));
const A = 'a'.repeat(24), B = 'b'.repeat(24), C = 'c'.repeat(24), D = 'd'.repeat(24);
const DAY = 86_400_000;

// ------------------------------------------------------------------ a made-up chain
type Tx = { blockTime: number; keys: string[]; pre: number[]; post: number[] };
const txs = new Map<string, Tx>(), by = new Map<string, { signature: string; blockTime: number; err: null }[]>();
function pay(lamports: number, at: number, ref?: string, to = WALLET) {
  const sig = b58(randomBytes(64)), keys = [PAYER, to, b58(new Uint8Array(32)), ...(ref ? [ref] : [])];
  txs.set(sig, { blockTime: Math.floor(at / 1000), keys, pre: [5e9, 1e9, 1, 0], post: [5e9 - lamports - 5000, 1e9 + lamports, 1, 0] });
  for (const k of [to, ...(ref ? [ref] : [])]) by.set(k, [{ signature: sig, blockTime: Math.floor(at / 1000), err: null }, ...(by.get(k) ?? [])]);
  return sig;
}
const chain = {
  async call(method: string, params: unknown[]) {
    if (method === 'getSignaturesForAddress') return (by.get(params[0] as string) ?? []).slice(0, (params[1] as { limit: number }).limit);
    if (method === 'getTransaction') {
      const t = txs.get(params[0] as string);
      return t ? { blockTime: t.blockTime, transaction: { message: { accountKeys: t.keys } }, meta: { err: null, preBalances: t.pre, postBalances: t.post } } : null;
    }
    throw new Error(`no ${method} on this chain`);
  },
} as unknown as Rpc;

const mem = new MemoryStore();
let clock = Date.parse('2026-10-22T12:00:00Z'), ip = 0;
const deps: Partial<Deps> = { store: mem, rpc: chain, env: { STORE_WALLET: WALLET, ADMIN_PASSWORD: 'a test password' }, now: () => clock, rate: async () => 100, game: 'http://game.test' };
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (body: unknown, d = deps): Promise<Out> =>
  (await storeApi(new Request('http://site.test/api/store', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': `10.0.0.${++ip}` } }), d)).json();
const get = async (q: string): Promise<Out> => (await storeApi(new Request(`http://site.test/api/store?${q}`), deps)).json();
const book = () => JSON.parse(mem.files.get(BOOK)!.text) as Book;

// a quote: dollars over the rate, rounded up to 0.00001 SOL, and four digits of its own
const qa = await post({ op: 'quote', item: 'vip', acct: A });
assert.equal(qa.ok, true);
assert.equal(qa.usd, 5);
assert.ok(qa.lamports > 50_000_000 && qa.lamports < 50_010_000, `5 dollars at 100 is 0.05 SOL and its digits: ${qa.lamports}`);
assert.equal(qa.sol, sol(qa.lamports));
assert.match(qa.url, new RegExp(`^solana:${WALLET}\\?amount=${qa.sol.replace('.', '\\.')}&reference=${qa.reference}&label=ZONA&`));
assert.equal(unseal('another secret', qa.token), null, 'a quote is sealed');
const forged = qa.token.replace(/^[^.]+/, Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(qa.token.split('.')[0], 'base64url').toString()), acct: C })).toString('base64url'));
assert.equal((await post({ op: 'claim', token: forged })).ok, false, 'a quote turned to another account is not ours');

// nothing paid yet: nothing found, nothing written
let r = await post({ op: 'claim', token: qa.token, name: 'Ghost', discord: 'ghost#1' });
assert.equal(r.ok, false);
assert.equal(r.wait, true);
assert.equal(mem.ops.swap, 0);

// paid from a phone: the reference is in the payment
clock += 60_000;
const s1 = pay(qa.lamports, clock, qa.reference);
r = await post({ op: 'claim', token: qa.token, name: 'Ghost', discord: 'ghost#1' });
assert.equal(r.ok, true, r.why);
assert.equal(r.status, 'ok');
assert.equal(r.sig, s1);
assert.ok(Math.abs(r.perks.vip - (clock + 30 * DAY)) < 2000, 'thirty days of VIP from when it landed');
assert.equal(mem.ops.swap, 1, 'one write for one purchase');
assert.equal(book().rows[0].how, 'ref');
assert.equal(book().rows[0].discord, 'ghost#1');
assert.equal(book().rows[0].from, PAYER);

// each payment once: the same quote finds nothing more, the signature pasted again is refused
assert.equal((await post({ op: 'claim', token: qa.token })).ok, false);
assert.match((await post({ op: 'claim', token: qa.token, sig: s1 })).why, /used already/);
assert.equal(mem.ops.swap, 1);

// paid from a computer: no reference, the exact amount; a payment of another amount beside it is not taken
const qb = await post({ op: 'quote', item: 'deagle_gold', acct: B });
const qc = await post({ op: 'quote', item: 'deagle_gold', acct: C });
assert.notEqual(qb.lamports, qc.lamports, 'two quotes for one thing differ in their last digits');
clock += 30_000;
pay(qb.lamports + 1, clock);
const s2 = pay(qb.lamports, clock);
r = await post({ op: 'claim', token: qb.token, name: 'Bee' });
assert.equal(r.ok, true, r.why);
assert.equal(r.sig, s2);
assert.deepEqual(r.perks.skins, ['deagle_gold']);
assert.equal(book().rows[1].how, 'amount');
// somebody watching the wallet: their own quote does not find B's payment, and pasting B's signature is refused
assert.equal((await post({ op: 'claim', token: qc.token })).ok, false);
assert.match((await post({ op: 'claim', token: qc.token, sig: s2 })).why, /used already/);

// a pasted signature: paid more than asked, so its amount matches nothing; VIP stacks on the month A has
const qa2 = await post({ op: 'quote', item: 'vip', acct: A });
clock += 5 * 60_000;
const s3 = pay(qa2.lamports + 1_000_000, clock);
assert.equal((await post({ op: 'claim', token: qa2.token })).ok, false);
r = await post({ op: 'claim', token: qa2.token, sig: s3 });
assert.equal(r.ok, true, r.why);
assert.equal(book().rows[2].how, 'sig');
assert.ok(Math.abs(r.perks.vip - (Date.parse('2026-10-22T12:01:00Z') + 60 * DAY)) < 2000, 'a second month is added to the first');

// short: kept for an admin, nothing granted; under half: refused and not written; made before the quote: refused
const qd = await post({ op: 'quote', item: 'colt_nickel', acct: D });
const old = pay(qd.lamports, clock - 10 * 60_000);
clock += 60_000;
const short = pay(Math.floor(qd.lamports * 0.8), clock), tiny = pay(Math.floor(qd.lamports * 0.3), clock);
const writes = mem.ops.swap;
assert.match((await post({ op: 'claim', token: qd.token, sig: old })).why, /before this quote/);
assert.match((await post({ op: 'claim', token: qd.token, sig: tiny })).why, /under half/);
assert.equal(mem.ops.swap, writes, 'nothing written for a refusal');
r = await post({ op: 'claim', token: qd.token, sig: short });
assert.equal(r.ok, true);
assert.equal(r.status, 'look');
assert.deepEqual(r.perks.skins, [], 'a short payment grants nothing until an admin says so');
// late: kept for an admin too
const qd2 = await post({ op: 'quote', item: 'm9_nickel', acct: D });
clock += 3 * 3_600_000;
r = await post({ op: 'claim', token: qd2.token, sig: pay(qd2.lamports, clock) });
assert.equal(r.status, 'look');
assert.match(book().rows.at(-1)!.why!, /ran out/);

// a coffee: the buyer's amount, with a note, and a cup for a week
const qcup = await post({ op: 'quote', item: 'coffee', acct: C, usd: 3 });
assert.equal(qcup.usd, 3);
assert.equal((await post({ op: 'quote', item: 'coffee', acct: C, usd: 0.2 })).usd, 1, 'a dollar at least');
clock += 20_000;
pay(qcup.lamports, clock, qcup.reference);
r = await post({ op: 'claim', token: qcup.token, note: 'for the fort' });
assert.equal(r.ok, true, r.why);
assert.ok(r.perks.cup > clock + 6 * DAY);
assert.equal(book().rows.at(-1)!.note, 'for the fort');

// who has what, for the game servers and the pages
const list = (await get('perks=1')) as PerkList;
assert.ok(list.who[A][0] > clock + 50 * DAY);
assert.deepEqual(list.who[B][3], ['deagle_gold']);
assert.equal(list.who[D], undefined, 'nothing granted to D yet');
const mine = await get(`acct=${A}`);
assert.equal(mine.open, true);
assert.equal(mine.rows.length, 2);

// an admin's orders, proved by the game server's word on the number
const orders = new Map<string, unknown>();
const real = globalThis.fetch;
globalThis.fetch = (async (u: string | URL) => {
  const m = String(u).match(/^http:\/\/game\.test\/adminop\/([0-9a-f]{32})$/);
  const op = m && orders.get(m[1]);
  return op ? Response.json(op) : new Response('{}', { status: 404 });
}) as typeof fetch;
const order = async (act: unknown) => {
  const n = randomBytes(16).toString('hex');
  orders.set(n, { op: 'store', act, by: 'Owner' });
  return (await storeApi(new Request(`http://site.test/api/store?n=${n}`, { method: 'POST' }), deps)).json() as Promise<Out>;
};
assert.equal((await storeApi(new Request(`http://site.test/api/store?n=${'0'.repeat(32)}`, { method: 'POST' }), deps)).status, 404, 'a number the game server did not make is nobody');
let v = (await order({ act: 'list' })).view;
assert.equal(v.rows.length, 6);
assert.equal(v.looks, 2);
assert.equal(v.vips.length, 1);
assert.equal(v.vips[0].discord, 'ghost#1');
assert.equal(v.month.n, 4, "the four paid and passed");
const look = book().rows.find((x) => x.item === 'colt_nickel')!;
v = (await order({ act: 'set', id: look.id, status: 'ok' })).view;
assert.deepEqual((await get('perks=1')).who[D][3], ['colt_nickel'], 'an admin passes a short payment');
const deagle = book().rows.find((x) => x.item === 'deagle_gold')!;
await order({ act: 'set', id: deagle.id, status: 'refunded' });
assert.equal((await get('perks=1')).who[B], undefined, 'refunded: the finish is gone');
await order({ act: 'move', id: look.id, acct: B });
assert.deepEqual((await get('perks=1')).who[B][3], ['colt_nickel'], 'moved to the account a player has now');
await order({ act: 'grant', acct: D, item: 'noads', days: 7, name: 'Dee' });
assert.ok((await get('perks=1')).who[D][1] > clock + 6 * DAY);
await order({ act: 'role', id: book().rows[0].id, on: true });
assert.equal(book().rows[0].role, true);
assert.equal(book().rows[0].by, 'Owner');
assert.equal((await order({ act: 'nuke' })).error, 'no such thing to do');
globalThis.fetch = real;

// numbered finishes (the owner: "each cosmetic sold should be reserved. we will only sell 100 gold deagles and 100 gold
// knives"): the lowest number nobody holds, none past the hundredth, and never a second of one to the same account
{
  const mem2 = new MemoryStore(), d2: Partial<Deps> = { ...deps, store: mem2 };
  const held = Array.from({ length: 100 }, (_, i) => i + 1).filter((n) => n !== 7).map((n) => ({
    id: rowId(`held ${n}`), sig: `held${n}`, item: 'deagle_gold', acct: n.toString(16).padStart(24, 'e'), name: '', usd: 4.99, rate: 100, quoted: 1, paid: 1, from: '', paidAt: 1, at: '2026-10-01T00:00:00.000Z', how: 'sig', status: 'ok', serial: n,
  }));
  mem2.put(BOOK, JSON.stringify({ rows: held }));
  assert.equal((await get('acct=' + A)).stock.knife_gold, 100);
  const q = await post({ op: 'quote', item: 'deagle_gold', acct: A }, d2);
  assert.equal(q.ok, true, q.why);
  clock += 10_000;
  const r2 = await post({ op: 'claim', token: q.token, sig: pay(q.lamports, clock) }, d2);
  assert.equal(r2.serial, 7, 'the lowest number nobody holds');
  assert.equal((await storeApi(new Request(`http://site.test/api/store?acct=${A}`), d2).then((x) => x.json())).stock.deagle_gold, 0);
  assert.match((await post({ op: 'quote', item: 'deagle_gold', acct: C }, d2)).why, /Sold out: all 100/);
  assert.match((await post({ op: 'quote', item: 'deagle_gold', acct: A }, d2)).why, /yours already/);
  // a quote made before the last one went: its payment is kept for an admin to refund, with no number
  const book2 = JSON.parse(mem2.files.get(BOOK)!.text) as Book;
  book2.rows = book2.rows.filter((x) => x.serial !== 50);
  mem2.put(BOOK, JSON.stringify(book2));
  const late = await post({ op: 'quote', item: 'deagle_gold', acct: C }, d2);
  book2.rows.push({ ...book2.rows[0], id: rowId('x'), sig: 'another', acct: D, serial: 50 });
  mem2.put(BOOK, JSON.stringify(book2));
  clock += 10_000;
  const lost = await post({ op: 'claim', token: late.token, sig: pay(late.lamports, clock) }, d2);
  assert.equal(lost.status, 'look');
  assert.match(lost.why, /sold out/);
  assert.equal(lost.serial, undefined);
}

// closed until the wallet is set
assert.equal((await post({ op: 'quote', item: 'vip', acct: A }, { ...deps, env: { ADMIN_PASSWORD: 'x' } })).why, 'The store is not open yet.');
assert.ok(SHOP.vip.usd === 5 && SHOP.deagle_gold.usd === 4.99, 'the owner’s prices');
console.log(`made-up chain: ok (${mem.ops.swap} writes for ${book().rows.length} purchases and 5 admin changes)`);

// ------------------------------------------------------------------ one real payment, read on mainnet
// A payout of 0.01 SOL that went out on 2026-10-18 (api/_lib/paid-before.ts), taken as if its wallet were the store's
// and it had paid a quote made a minute before it. Nothing is sent: getTransaction and nothing else.
const REAL = { sig: 'S3SUSduguYM5Z5jXG7RGw6JupUrgCyZd9Px1iP7XLreqoehMt9GPyeXSFV4zEnRJdkcZoGbAkEge4yLE2QCzA5b', to: 'J5zhTr7PmxhEchBruw8H2RFNz37rB2Ufp7Ab3aSnpYr9', at: 1792354394_000 };
const mainnet = new Rpc('https://api.mainnet-beta.solana.com', 20_000);
const seen = await paymentOf(mainnet, REAL.sig, REAL.to).catch((e: Error) => e);
if (seen instanceof Error) console.log(`mainnet: skipped, not reachable (${seen.message})`);
else {
  assert.equal(seen?.gained, 10_000_000);
  assert.equal(seen?.at, REAL.at);
  const live: Partial<Deps> = { store: new MemoryStore(), rpc: mainnet, env: { STORE_WALLET: REAL.to, ADMIN_PASSWORD: 'a test password' }, now: () => REAL.at - 60_000, rate: async () => 600 };
  const q = await post({ op: 'quote', item: 'vip', acct: A }, live);
  assert.ok(q.lamports <= 10_000_000, '5 dollars at 600 is under the 0.01 SOL that came');
  const c = await post({ op: 'claim', token: q.token, sig: REAL.sig, name: 'Real' }, live);
  assert.equal(c.ok, true, c.why);
  assert.equal(c.status, 'ok');
  assert.match((await post({ op: 'claim', token: q.token, sig: REAL.sig }, live)).why, /used already/);
  const wrong = await post({ op: 'claim', token: q.token, sig: REAL.sig }, { ...live, env: { STORE_WALLET: WALLET, ADMIN_PASSWORD: 'a test password' } });
  assert.equal(wrong.ok, false, 'the same payment to any other wallet is nothing');
  console.log(`mainnet: ok (${REAL.sig.slice(0, 12)}… brought ${sol(seen!.gained)} SOL from ${seen!.from.slice(0, 6)}…, booked as VIP once)`);
}
