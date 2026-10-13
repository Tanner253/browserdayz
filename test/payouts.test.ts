// The payout system against a chain made up for the purpose (test/fake.ts): one that loses
// transactions, takes its time, refuses, forgets, and is asked the same thing twice at once.
// No network, no real key, no money. `npx tsx test/payouts.test.ts`

import assert from 'node:assert/strict';
import http from 'node:http';
import { address, b58, seeded, signed } from '../api/_lib/solana';
import { LOT_MAX, RULES2_FROM, claimIfDue, config, dueOf, handle, payment, price, readBook, refOf, snapshot, sweep, termsOf, type Book, type Entry, type Outcome } from '../api/_lib/payouts';
import { record } from '../api/cashin';
import { show } from '../api/cashins';
import { MemoryStore, check } from '../api/_lib/store';
import { FEE, KEY, RENT, SEED, SOL, TREASURY, attempts, got, parse, tag, tries, wallet, world } from './fake';

let n = 0;
const test = async (name: string, fn: () => Promise<void>) => {
  await fn();
  n++;
  console.log('  ok  ' + name);
};
/** what one payment takes out of the treasury besides the payment itself: its fee, and what its receipt holds */
const COST = FEE + RENT;
const receiptOf = (id: string) => b58(seeded(TREASURY.publicKey, refOf(id)));

// ------------------------------------------------------------------ the checks

await test('settings: the price of a tag, and what is refused', async () => {
  const c = config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: KEY });
  assert.equal(c.mode, 'on');
  assert.equal(b58(c.treasury!), TREASURY.address);
  // two per cent of what can be spent, and never less than 0.01 (it was 0.02 until 2026-10-13)
  assert.equal(price(SOL(0.44), c), SOL(0.01));
  assert.equal(price(SOL(1.01), c), SOL(0.02));
  assert.equal(price(SOL(10.01), c), SOL(0.2));
  assert.equal(price(SOL(100.01), c), SOL(2));
  assert.equal(price(SOL(1000), c), SOL(5));
  assert.equal(price(0n, c), SOL(0.01));
  assert.equal(price(SOL(100.01), config({ TAG_PAY_PERCENT: '5', TAG_PAY_MIN_SOL: '0.1', TAG_PAY_MAX_SOL: '3' })), SOL(3));
  // on, with no key: off, and it says why. A key that is not the treasury's: the same.
  assert.match(config({ PAYOUTS: 'on' }).problem ?? '', /no TREASURY_SECRET_KEY/);
  assert.equal(config({ PAYOUTS: 'on' }).mode, 'off');
  const wrong = config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: KEY, TREASURY_ADDRESS: wallet(1) });
  assert.equal(wrong.mode, 'off');
  assert.equal(wrong.key, null);
  assert.match(wrong.problem ?? '', /not the key of TREASURY_ADDRESS/);
  assert.equal(config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: 'garbage!' }).mode, 'off');
  // nothing said about a key gives the key away
  for (const bad of ['garbage!', KEY.slice(0, 40), '[1,2,3]']) assert.ok(!(config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: bad }).problem ?? '').includes(bad));
  assert.equal(config({}).mode, 'off');
  assert.equal(config({ TREASURY_SECRET_KEY: KEY }).mode, 'off');
  // a node's address that is not https is refused, and not repeated
  const plainNode = config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: KEY, SOLANA_RPC_URL: 'http://node.example/secret-key-123' });
  assert.equal(plainNode.mode, 'off');
  assert.ok(!(plainNode.problem ?? '').includes('secret-key-123'));
});

await test('a tag is paid: the right amount, to the right wallet, with its name on it and its receipt left behind', async () => {
  const w = world(1);
  const e = tag(w, 1);
  const o = await handle(w, e);
  assert.equal(o.state, 'paid');
  assert.equal(got(w, 1), SOL(0.02));
  assert.equal(got(w, TREASURY.address), SOL(1) - SOL(0.02) - COST);
  const book = await readBook(w.store);
  assert.equal(book.rows.length, 1);
  assert.deepEqual([book.rows[0].state, book.rows[0].lamports, book.paid, book.paidLamports, book.tags], ['paid', 20_000_000, 1, 20_000_000, 1]);
  assert.equal(book.rows[0].signature, o.state === 'paid' ? o.signature : '');
  assert.ok(book.since);
  assert.equal(tries(w, e.id), 1);
  const sent = parse(Uint8Array.from(Buffer.from(attempts(w, e.id)[0].wire, 'base64')));
  // the note on it names the tag by its reference, never by its id
  assert.deepEqual(sent.memos, [`ZONA dog tag ${refOf(e.id)}`]);
  assert.ok(!refOf(e.id).includes(e.id) && book.rows[0].ref === refOf(e.id));
  // its receipt: an account of its own, at an address made from the treasury and the tag
  assert.deepEqual(sent.creates.map((c) => [b58(c.at), c.lamports]), [[receiptOf(e.id), RENT]]);
  assert.equal(book.rows[0].receipt, receiptOf(e.id));
  assert.equal(got(w, receiptOf(e.id)), RENT);
  // (once it is paid the book no longer carries the attempts)
  assert.equal(book.rows[0].tries, undefined);
});

await test('a fuller treasury pays more', async () => {
  const w = world(100.01);
  assert.equal((await handle(w, tag(w, 2))).state, 'paid');
  assert.equal(got(w, 2), SOL(2));
});

await test('asked again, and again, and three times at once: still paid once', async () => {
  const w = world(1);
  const e = tag(w, 3);
  const all = await Promise.all([handle(w, e), handle(w, e), handle(w, e)]);
  w.skip(5000);
  for (let i = 0; i < 4; i++) assert.equal((await handle(w, e)).state, 'paid');
  assert.ok(all.some((o) => o.state === 'paid' || o.state === 'sending'));
  assert.equal(got(w, 3), SOL(0.02));
  assert.equal(tries(w, e.id), 1);
  assert.equal(new Set(w.chain.handedIn).size, 1);
  assert.equal((await readBook(w.store)).paid, 1);
});

await test('a payment the chain is slow to take is waited for, not sent again', async () => {
  const w = world(1);
  w.chain.landAfter = 100;
  const e = tag(w, 4);
  const first = await handle(w, e);
  assert.equal(first.state, 'sending');
  assert.equal(got(w, 4), 0n);
  w.skip(30_000);
  const later = await handle(w, e);
  assert.equal(later.state, 'paid');
  assert.equal(later.state === 'paid' && first.state === 'sending' && later.signature === first.signature, true);
  assert.equal(got(w, 4), SOL(0.02));
  assert.equal(tries(w, e.id), 1);
});

await test('a payment that is lost is sent again only once it can no longer arrive', async () => {
  const w = world(1);
  w.chain.lose = true;
  const e = tag(w, 5);
  assert.equal((await handle(w, e)).state, 'sending');
  // half a minute on it could still turn up: nothing new is signed
  w.skip(30_000);
  assert.equal((await handle(w, e)).state, 'sending');
  assert.equal(tries(w, e.id), 1);
  // past its last block, and past the blocks that could still be undone
  w.skip(60_000);
  w.chain.lose = false;
  assert.equal((await handle(w, e)).state, 'paid');
  assert.equal(tries(w, e.id), 2);
  assert.equal(got(w, 5), SOL(0.02));
  w.skip(120_000);
  assert.equal((await handle(w, e)).state, 'paid');
  assert.equal(got(w, 5), SOL(0.02));
});

await test('lost, but handed in again while it could still arrive: the same payment lands, once', async () => {
  const w = world(1);
  w.chain.lose = true;
  const e = tag(w, 6);
  const first = await handle(w, e);
  w.chain.lose = false;
  w.skip(2000);
  assert.equal((await handle(w, e)).state, 'sending');
  w.skip(2000);
  const o = await handle(w, e);
  assert.equal(o.state, 'paid');
  assert.equal(o.state === 'paid' && first.state === 'sending' && o.signature === first.signature, true);
  assert.equal(tries(w, e.id), 1);
  assert.equal(got(w, 6), SOL(0.02));
});

await test('the worker dies after writing the attempt down and before sending it', async () => {
  const w = world(1);
  const e = tag(w, 7);
  let armed = true;
  w.store.after = () => {
    if (armed && tries(w, e.id)) {
      armed = false;
      throw new Error('the function was cut off');
    }
  };
  const first = await handle(w, e);
  assert.equal(first.state, 'waiting');
  assert.equal(w.chain.handedIn.length, 0);
  assert.equal(tries(w, e.id), 1);
  // (what it was told is not what the book says: the book has the attempt, and nothing overwrote it)
  assert.equal((await readBook(w.store)).rows[0].state, 'sending');
  // whoever asks next finds the attempt, hands that same transaction in, and it is the payment
  assert.equal((await handle(w, e)).state, 'sending');
  w.skip(3000);
  assert.equal((await handle(w, e)).state, 'paid');
  assert.equal(tries(w, e.id), 1);
  assert.equal(got(w, 7), SOL(0.02));
});

await test('a node that refuses, and a payment that gets in and fails', async () => {
  const w = world(1);
  w.chain.refuse = true;
  const e = tag(w, 8);
  assert.equal((await handle(w, e)).state, 'sending');
  w.chain.refuse = false;
  w.chain.lose = true;
  w.skip(100_000);
  // the second gets in late, and fails there: only when that failure can no longer be undone is a third made
  w.chain.lose = false;
  w.chain.failNext = true;
  w.chain.landAfter = 50;
  assert.equal((await handle(w, e)).state, 'sending');
  assert.equal(tries(w, e.id), 2);
  assert.equal((await handle(w, e)).state, 'sending');
  assert.equal(tries(w, e.id), 2);
  assert.equal(got(w, 8), 0n);
  w.chain.landAfter = 2;
  w.skip(20_000);
  assert.equal((await handle(w, e)).state, 'paid');
  assert.equal(tries(w, e.id), 3);
  assert.equal(got(w, 8), SOL(0.02));
});

await test('five attempts and no more', async () => {
  const w = world(1);
  w.chain.lose = true;
  const e = tag(w, 9);
  for (let i = 0; i < 9; i++) {
    await handle(w, e);
    w.skip(100_000);
  }
  const o = await handle(w, e);
  assert.equal(o.state, 'waiting');
  assert.match(o.state === 'waiting' ? o.why : '', /needs looking at/);
  assert.equal(tries(w, e.id), 5);
  assert.equal(got(w, 9), 0n);
  // and from then on it is left for a person: asking again asks nothing of anybody
  const before = { ...w.store.ops, sent: w.chain.handedIn.length };
  await handle(w, e);
  await sweep(w);
  assert.deepEqual([w.store.ops.read, w.store.ops.swap, w.chain.handedIn.length], [before.read, before.swap, before.sent]);
});

await test('what is not paid, and why', async () => {
  const w = world(1);
  const why = async (e: Entry) => {
    const o = await handle(w, e);
    assert.equal(o.state, 'skipped');
    return o.state === 'skipped' ? o.why : '';
  };
  assert.match(await why(tag(w, '')), /no wallet/);
  assert.match(await why(tag(w, 'not-a-wallet-at-all-not-a-wallet-at-all')), /not a wallet address/);
  assert.match(await why(tag(w, TREASURY.address)), /cannot be paid|can be paid/);
  const tokenAccount = wallet(500);
  w.chain.programOwned.add(tokenAccount);
  assert.match(await why(tag(w, tokenAccount)), /belongs to a program/);
  // an address made by a program from seeds, never used: nobody could ever spend what was sent there
  assert.match(await why(tag(w, '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf')), /nobody holds the key|anybody holds the key/);
  assert.match(await why(tag(w, 10, { at: new Date(w.now() - 4 * 24 * 3600 * 1000).toISOString() })), /three days/);
  assert.match(await why(tag(w, 10, { at: 'whenever' })), /three days/);
  assert.equal(w.chain.handedIn.length, 0);
  // cashed in before the machine was switched on: listed, never paid by it
  const book = await readBook(w.store);
  assert.match(await why(tag(w, 11, { at: new Date(Date.parse(book.since!) - 60_000).toISOString() })), /before automatic payouts/);
  assert.equal(got(w, 11), 0n);
});

await test('one wallet, so many tags a day', async () => {
  const w = world(5);
  for (let i = 0; i < 3; i++) assert.equal((await handle(w, tag(w, 12))).state, 'paid');
  const fourth = tag(w, 12);
  const o = await handle(w, fourth);
  assert.equal(o.state, 'waiting');
  assert.match(o.state === 'waiting' ? o.why : '', /wait for tomorrow/);
  // asked about again today, by the game server or by the housekeeping: nothing is asked of the file service or the chain
  const before = { ...w.store.ops };
  for (let i = 0; i < 5; i++) assert.equal((await handle(w, fourth)).state, 'waiting');
  assert.equal((await sweep(w)).tried, 0);
  assert.deepEqual([w.store.ops.read, w.store.ops.swap], [before.read, before.swap]);
  // somebody else is not held up by it
  assert.equal((await handle(w, tag(w, 13))).state, 'paid');
  // and tomorrow it goes
  w.skip(13 * 3600 * 1000);
  assert.equal((await handle(w, fourth)).state, 'paid');
  assert.ok(got(w, 12) >= SOL(0.32) && got(w, 12) <= SOL(0.4));
  assert.equal((await readBook(w.store)).rows.filter((r) => r.wallet === wallet(12) && r.state === 'paid').length, 4);
});

// ---- the rules of 2026-10-13, for what is cashed in after they began (every world above stands before that day,
// and is paid as it was promised: at 0.02 at least, with what is over a wallet's three waiting for tomorrow)
const RULES = { PAYOUT_RULES_FROM: '2026-10-01T00:00:00Z' };

await test('from 13 October: a tag pays 0.01 at least, and a wallet\'s three a day is a limit, not a queue', async () => {
  const w = world(0.3, RULES);
  // (two per cent of 0.3 is 0.006: the least is what is paid)
  for (let i = 0; i < 3; i++) assert.equal((await handle(w, tag(w, 80))).state, 'paid');
  assert.equal(got(w, 80), SOL(0.03));
  const fourth = tag(w, 80);
  const o = await handle(w, fourth);
  assert.equal(o.state, 'skipped');
  assert.match(o.state === 'skipped' ? o.why : '', /had cashed in 3 tags already that day: no more are paid to it for that day/);
  // somebody else is not held up by it
  assert.equal((await handle(w, tag(w, 81))).state, 'paid');
  // and tomorrow that wallet is paid again, for what is cashed in tomorrow: the one that was over is not paid then
  w.skip(13 * 3600 * 1000);
  assert.equal((await sweep(w)).tried, 0);
  assert.equal((await handle(w, fourth)).state, 'skipped');
  assert.equal((await handle(w, tag(w, 80))).state, 'paid');
  assert.equal(got(w, 80), SOL(0.04));
  const rows = (await readBook(w.store)).rows.filter((r) => r.wallet === wallet(80));
  assert.deepEqual([rows.filter((r) => r.state === 'paid').length, rows.filter((r) => r.state === 'skipped').length], [4, 1]);
});

await test('from 13 October: a tag that was one of its day\'s three, and waited for the treasury, is paid when it fills, whatever has gone out since', async () => {
  // (Found on reading, 2026-10-13. Day one: three tags, the treasury good for one. Day two: three more, and then
  // the treasury fills. All six were among their own day's three: all six are paid. Two were refused for good.)
  // (0.025: one tag at the least, and what the treasury keeps back)
  const w = world(0.025, RULES);
  const first = [tag(w, 90), tag(w, 90), tag(w, 90)];
  const one = [];
  for (const t of first) one.push((await handle(w, t)).state);
  assert.deepEqual(one, ['paid', 'waiting', 'waiting'], 'the treasury was good for one of the three');
  // (and a fourth, that same day, is over the limit whether or not the three have been paid yet)
  const over = tag(w, 90);
  assert.equal((await handle(w, over)).state, 'skipped');
  w.skip(13 * 3600 * 1000);
  const second = [tag(w, 90), tag(w, 90), tag(w, 90)];
  w.chain.balances.set(TREASURY.address, got(w, TREASURY.address) + SOL(2));
  for (const t of second) assert.equal((await handle(w, t)).state, 'paid');
  // (the two of yesterday that waited: paid at the next look, though three have gone to this wallet today)
  w.skip(60_000);
  await sweep(w);
  for (const t of first) assert.equal((await handle(w, t)).state, 'paid', 'one of the first day\'s three was not paid when the treasury filled');
  assert.equal((await handle(w, over)).state, 'skipped');
  const rows = (await readBook(w.store)).rows.filter((r) => r.wallet === wallet(90));
  assert.deepEqual([rows.filter((r) => r.state === 'paid').length, rows.filter((r) => r.state === 'skipped').length, rows.filter((r) => r.state === 'waiting').length], [6, 1, 0]);
  // (and a fourth of the second day is over that day's limit)
  assert.equal((await handle(w, tag(w, 90))).state, 'skipped');
});

await test('from 13 October: two who cash each other\'s tags inside a day are paid for the first and not the second', async () => {
  const w = world(2, RULES);
  // Ann cashes Bob's tag: paid. Bob then cashes Ann's: not paid.
  assert.equal((await handle(w, tag(w, 82, { name: 'Ann', owner: 'Bob' }))).state, 'paid');
  const back = await handle(w, tag(w, 83, { name: 'Bob', owner: 'Ann' }));
  assert.equal(back.state, 'skipped');
  assert.match(back.state === 'skipped' ? back.why : '', /cashed each other's tags inside a day/);
  assert.equal(got(w, 83), 0n);
  // (somebody else's tag is Bob's to be paid for, and so is Ann's from somebody else)
  assert.equal((await handle(w, tag(w, 83, { name: 'Bob', owner: 'Cy' }))).state, 'paid');
  assert.equal((await handle(w, tag(w, 84, { name: 'Dee', owner: 'Ann' }))).state, 'paid');
  // a name is whatever is typed: Bob under another name, to the same wallet, is Bob
  const again = await handle(w, tag(w, 83, { name: 'Robert', owner: 'ann ' }));
  assert.equal(again.state, 'skipped');
  // and Ann under another name, to her own wallet, cashing the tag of whoever cashed one of hers
  assert.equal((await handle(w, tag(w, 85, { name: 'Eve', owner: 'Fay' }))).state, 'paid');
  assert.equal((await handle(w, tag(w, 86, { name: 'Fay', owner: 'Gus' }))).state, 'paid');
  const renamed = await handle(w, tag(w, 86, { name: 'Somebody', owner: 'EVE' }));
  assert.equal(renamed.state, 'skipped', 'whoever cashed as Fay, cashing Eve\'s tag under another name, was paid');
  // a day later it is no trade
  w.skip(25 * 3600 * 1000);
  assert.equal((await handle(w, tag(w, 83, { name: 'Bob', owner: 'Ann' }))).state, 'paid');
  // (and nothing of this is asked of a tag from before the rules: see the world of the test before last)
  const old = world(2);
  assert.equal((await handle(old, tag(old, 87, { name: 'Ann', owner: 'Bob' }))).state, 'paid');
  assert.equal((await handle(old, tag(old, 88, { name: 'Bob', owner: 'Ann' }))).state, 'paid');
});

await test('a tag kept waiting by the day\'s limits is not too old when its turn comes', async () => {
  // fourteen tags to one wallet in an hour: three a day, so the last of them waits four days
  const w = world(5);
  const all: Entry[] = [];
  for (let i = 0; i < 14; i++) {
    all.push(tag(w, 14));
    await handle(w, all[i]);
  }
  for (let d = 0; d < 5; d++) {
    w.skip(24 * 3600 * 1000);
    await sweep(w);
  }
  const rows = (await readBook(w.store)).rows.filter((r) => r.wallet === wallet(14));
  assert.deepEqual([rows.length, rows.filter((r) => r.state === 'paid').length, rows.filter((r) => r.state === 'skipped').length], [14, 14, 0]);
  // and never more than three of them on one day
  const days = new Map<string, number>();
  for (const r of rows) days.set(r.day!, (days.get(r.day!) ?? 0) + 1);
  assert.ok([...days.values()].every((n) => n <= 3));
  // one that comes four days late is still refused
  const late = await handle(w, tag(w, 15, { at: new Date(w.now() - 4 * 24 * 3600 * 1000).toISOString() }));
  assert.equal(late.state, 'skipped');
});

await test('no more than three quarters of the treasury in a day', async () => {
  const w = world(0.21);
  const states: string[] = [];
  const held: Entry[] = [];
  for (let i = 0; i < 10; i++) {
    const e = tag(w, 20 + i);
    const o = await handle(w, e);
    states.push(o.state);
    if (o.state === 'waiting') held.push(e);
  }
  assert.deepEqual(states, ['paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'waiting', 'waiting', 'waiting']);
  assert.ok(got(w, TREASURY.address) > SOL(0.21 * 0.25));
  // asked about again the same day, with nothing changed: nothing is asked of the file service, and nothing is sent
  const before = { ...w.store.ops, sent: w.chain.handedIn.length };
  for (const e of held) assert.equal((await handle(w, e)).state, 'waiting');
  assert.equal((await sweep(w)).tried, 0);
  assert.deepEqual([w.store.ops.read, w.store.ops.swap, w.chain.handedIn.length], [before.read, before.swap, before.sent]);
  // the day after, the ones that waited are paid until three quarters of what is left has gone too
  w.skip(13 * 3600 * 1000);
  const r = await sweep(w);
  assert.equal(r.paid, 2);
  assert.deepEqual([27, 28, 29].map((i) => got(w, i)).sort(), [0n, SOL(0.02), SOL(0.02)]);
  assert.equal(held.length, 3);
});

await test('held by the day\'s limit, and paid the same day when the treasury is filled', async () => {
  const w = world(0.21, { PAYOUT_DAY_CAP_PERCENT: '50' });
  const held: Entry[] = [];
  for (let i = 0; i < 8; i++) {
    const e = tag(w, 700 + i);
    if ((await handle(w, e)).state === 'waiting') held.push(e);
  }
  assert.equal(held.length, 3);
  assert.equal((await sweep(w)).tried, 0);
  // creator rewards come in: the limit is a share of the most the treasury has held today, and there is room again
  w.chain.balances.set(TREASURY.address, got(w, TREASURY.address) + SOL(0.3));
  w.skip(60_000);
  const r = await sweep(w);
  assert.equal(r.paid, 3);
  for (let i = 5; i < 8; i++) assert.equal(got(w, 700 + i), SOL(0.02));
  // and not twice
  w.skip(60_000);
  assert.equal((await sweep(w)).tried, 0);
  assert.equal((await readBook(w.store)).rows.filter((x) => x.state === 'paid').length, 8);
});

await test('a limit that is raised lets through what the lower one held, and no more than it allows', async () => {
  const low = world(0.21, { PAYOUT_DAY_CAP_PERCENT: '50' });
  const held: Entry[] = [];
  for (let i = 0; i < 9; i++) {
    const e = tag(low, 720 + i);
    if ((await handle(low, e)).state === 'waiting') held.push(e);
  }
  assert.equal(held.length, 4);
  // the same book and the same chain, the limit raised: 0.21 x 75% = 0.1575, so seven in the day
  Object.assign(low, { cfg: { ...low.cfg, dayShare: 0.75 } });
  low.skip(60_000);
  const r = await sweep(low);
  assert.equal(r.paid, 2);
  assert.equal((await readBook(low.store)).rows.filter((x) => x.state === 'paid').length, 7);
  assert.equal((await readBook(low.store)).rows.filter((x) => x.state === 'waiting').length, 2);
  // the wallet's own limit still holds whatever the treasury's is
  const w = world(5);
  for (let i = 0; i < 3; i++) await handle(w, tag(w, 740));
  const fourth = tag(w, 740);
  assert.equal((await handle(w, fourth)).state, 'waiting');
  w.chain.balances.set(TREASURY.address, got(w, TREASURY.address) + SOL(5));
  w.skip(60_000);
  assert.equal((await sweep(w)).tried, 0);
});

await test('thirty at once cannot slip under the limits together', async () => {
  // to one wallet: three, however they arrive
  const one = world(5);
  const same = Array.from({ length: 30 }, () => tag(one, 14));
  await Promise.all(same.map((e) => handle(one, e)));
  one.skip(5000);
  for (const e of same) await handle(one, e);
  assert.equal(got(one, 14) > 0n, true);
  assert.equal((await readBook(one.store)).rows.filter((r) => r.state === 'paid').length, 3);
  assert.equal(new Set(one.chain.handedIn).size, 3);
  // to thirty wallets: no more than three quarters of what the treasury began the day with
  const many = world(0.5);
  const each = Array.from({ length: 30 }, (_, i) => tag(many, 600 + i));
  await Promise.all(each.map((e) => handle(many, e)));
  many.skip(5000);
  for (const e of each) await handle(many, e);
  const paid = (await readBook(many.store)).rows.filter((r) => r.state === 'paid');
  assert.ok(paid.length >= 15 && paid.length <= 18, `${paid.length} paid`);
  // (thirty at once keep each other waiting at the book: some of their transactions are too old to be taken by the
  // time they are sent, and are made again. What matters is what left the treasury, and that is what is counted.)
  assert.equal(SOL(0.5) - got(many, TREASURY.address), BigInt(paid.length) * (SOL(0.02) + COST));
  for (let i = 0; i < 30; i++) assert.ok(got(many, 600 + i) === 0n || got(many, 600 + i) === SOL(0.02));
});

await test('an empty treasury collects its creator rewards first, and then pays', async () => {
  const w = world(0.015);
  w.chain.rewards = SOL(0.3);
  const e = tag(w, 30);
  const o = await handle(w, e);
  assert.equal(o.state, 'paid');
  assert.equal(got(w, 30), SOL(0.02));
  assert.equal(w.chain.rewards, 0n);
  const book = await readBook(w.store);
  assert.equal(book.claims.length, 1);
  // (what is counted is what the treasury was seen to gain by it: the rewards less the fee of collecting them)
  assert.deepEqual([book.claims[0].from, book.claims[0].lamports, book.claimedLamports], ['curve', Number(SOL(0.3) - FEE), Number(SOL(0.3) - FEE)]);
  // and it was the treasury that collected them, by itself: nothing else moved
  assert.equal(w.chain.balances.size, 3);
  assert.equal(got(w, TREASURY.address), SOL(0.015) + SOL(0.3) - FEE - SOL(0.02) - COST);
});

await test('nothing to collect and nothing to pay with: the tag waits, and is paid when rewards come', async () => {
  const w = world(0.015);
  const e = tag(w, 31);
  const o = await handle(w, e);
  assert.equal(o.state, 'waiting');
  assert.match(o.state === 'waiting' ? o.why : '', /treasury is too low/);
  assert.equal(w.chain.handedIn.length, 0);
  assert.equal(tries(w, e.id), 0);
  // while the treasury stays empty the housekeeping asks nothing of the file service about it
  const before = { ...w.store.ops };
  w.skip(10 * 60_000);
  assert.equal((await sweep(w)).tried, 0);
  assert.deepEqual([w.store.ops.read, w.store.ops.swap], [before.read, before.swap]);
  w.chain.rewards = SOL(0.5);
  w.skip(10 * 60_000);
  const r = await sweep(w);
  assert.match(r.claim ?? '', /collected/);
  assert.equal(r.paid, 1);
  assert.equal(got(w, 31), SOL(0.02));
});

await test('rewards are collected when enough are waiting, and a claim that would fail is not sent', async () => {
  const w = world(1);
  // too little to be worth the fee: left where it is
  w.chain.rewards = SOL(0.01);
  assert.match((await claimIfDue(w)) ?? '', /not enough to collect/);
  assert.equal(w.chain.handedIn.length, 0);
  w.chain.rewards = SOL(0.3);
  w.chain.simFails = true;
  const note = await claimIfDue(w);
  assert.match(note ?? '', /not sent \(it would fail/);
  assert.equal(w.chain.handedIn.length, 0);
  assert.match((await readBook(w.store)).claimNote, /it would fail/);
  // asked again: tried again, still not sent, and nothing new written about it
  const writes = w.store.ops.swap;
  assert.match((await claimIfDue(w)) ?? '', /not sent/);
  assert.equal(w.store.ops.swap, writes);
  w.chain.simFails = false;
  assert.match((await claimIfDue(w)) ?? '', /collected/);
  assert.equal(got(w, TREASURY.address), SOL(1.3) - FEE);
  assert.equal((await readBook(w.store)).claimNote, '');
  // asked again at once: there is nothing left to collect, so nothing is sent
  assert.match((await claimIfDue(w)) ?? '', /not enough to collect/);
  assert.equal(w.chain.handedIn.length, 1);
  // the housekeeping collects by itself, with no tag to prompt it
  w.chain.rewards = SOL(0.06);
  assert.match((await sweep(w)).claim ?? '', /collected/);
  assert.equal(w.chain.handedIn.length, 2);
  assert.equal((await readBook(w.store)).claims.length, 2);
  // rewards that belong to somebody else's coin, or to a coin that shares them out, are left alone
  w.chain.rewards = SOL(1);
  w.coinState = { ...w.coinState, creator: address(wallet(999)) };
  assert.match((await claimIfDue(w)) ?? '', /cannot be collected/);
  w.coinState = { ...w.coinState, creator: TREASURY.publicKey, unsupported: 'the coin shares its creator fees between several wallets' };
  assert.match((await claimIfDue(w)) ?? '', /nothing to collect/);
  assert.equal(w.chain.handedIn.length, 2);
});

await test('a key that is not the key of the wallet that made the coin pays nothing', async () => {
  const w = world(1);
  w.coinState = { ...w.coinState, creator: address(wallet(998)) };
  const e = tag(w, 32);
  const o = await handle(w, e);
  assert.equal(o.state, 'waiting');
  assert.match(o.state === 'waiting' ? o.why : '', /nothing is paid until the key of that wallet is given/);
  assert.equal(w.chain.handedIn.length, 0);
  assert.equal(got(w, TREASURY.address), SOL(1));
  const s = await snapshot(w);
  assert.match(s.problem ?? '', /the coin was made by/);
  assert.equal(s.due, false);
  // the housekeeping says once, in the book, that the rewards cannot be collected with this key; and while that is
  // so, nothing more is asked about the tag or written about either
  assert.match((await sweep(w)).claim ?? '', /cannot be collected/);
  assert.match((await readBook(w.store)).claimNote, /cannot be collected/);
  const before = { ...w.store.ops };
  assert.equal((await sweep(w)).tried, 0);
  assert.deepEqual([w.store.ops.read, w.store.ops.swap], [before.read, before.swap]);
  // put right, the tag that waited is paid
  w.coinState = { ...w.coinState, creator: TREASURY.publicKey };
  assert.equal((await sweep(w)).paid, 1);
  assert.equal(got(w, 32), SOL(0.02));
  // (and whoever means to pay from another wallet can say so)
  const meant = world(1, { TREASURY_NOT_THE_MAKER: 'yes' });
  meant.coinState = { ...meant.coinState, creator: address(wallet(998)) };
  assert.equal((await handle(meant, tag(meant, 33))).state, 'paid');
});

await test('switched off it only keeps the list; a dry run tries and does not send', async () => {
  const off = world(1, { PAYOUTS: 'off' });
  const e = tag(off, 40);
  assert.equal((await handle(off, e)).state, 'off');
  assert.equal(off.chain.handedIn.length, 0);
  assert.equal((await readBook(off.store)).rows[0].state, 'off');
  assert.equal((await readBook(off.store)).since, null);
  // switched on a minute later: what is cashed in from then on is paid, and what was listed
  // while it was off stays listed. Off is a no, not a not-yet.
  off.skip(60_000);
  off.cfg = config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: KEY });
  await handle(off, tag(off, 41));
  assert.equal(got(off, 41), SOL(0.02));
  assert.equal((await handle(off, e)).state, 'off');
  assert.equal((await sweep(off)).tried, 0);
  assert.equal(got(off, 40), 0n);

  // switched off while a tag is waiting: it is left exactly as it is, and carries on when payouts are on again
  const w = world(0.015);
  const owed = tag(w, 44);
  assert.equal((await handle(w, owed)).state, 'waiting');
  w.cfg = config({ PAYOUTS: 'off', TREASURY_SECRET_KEY: KEY });
  w.chain.rewards = SOL(0.5);
  assert.equal((await handle(w, owed)).state, 'waiting');
  assert.deepEqual(await sweep(w), { tried: 0, paid: 0, claim: null });
  assert.equal(w.chain.handedIn.length, 0);
  w.cfg = config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: KEY });
  assert.equal((await sweep(w)).paid, 1);
  assert.equal(got(w, 44), SOL(0.02));

  const dry = world(1, { PAYOUTS: 'dry', TREASURY_SECRET_KEY: '', TREASURY_ADDRESS: TREASURY.address });
  assert.equal(dry.cfg.mode, 'dry');
  assert.equal(dry.cfg.key, null);
  const o = await handle(dry, tag(dry, 42));
  assert.equal(o.state, 'waiting');
  assert.match(o.state === 'waiting' ? o.why : '', /dry run: would pay 0.02 SOL \(tried, and it would go through\)/);
  assert.equal(dry.chain.handedIn.length, 0);
  assert.equal(got(dry, 42), 0n);
});

await test('many tags at once: each paid once, and the book adds up', async () => {
  const w = world(50, { PAYOUT_DAY_CAP_PERCENT: '100' });
  const es = Array.from({ length: 12 }, (_, i) => tag(w, 100 + i));
  await Promise.all(es.map((e) => handle(w, e)));
  w.skip(5000);
  for (const e of es) assert.equal((await handle(w, e)).state, 'paid');
  const book = await readBook(w.store);
  assert.equal(book.paid, 12);
  assert.equal(book.rows.length, 12);
  let total = 0n;
  for (let i = 0; i < 12; i++) {
    assert.ok(got(w, 100 + i) > 0n);
    total += got(w, 100 + i);
  }
  assert.equal(BigInt(book.paidLamports), total);
  assert.equal(got(w, TREASURY.address), SOL(50) - total - 12n * COST);
});

await test('what one payment costs the file service', async () => {
  const w = world(1);
  await handle(w, tag(w, 200));
  // writes are what there are fewest of. The first payment there ever is: the book noting
  // when payouts began, the attempt, the payment.
  assert.deepEqual([w.store.ops.swap, w.store.ops.read, w.store.ops.list], [3, 1, 0]);
  // every one after it: two writes (the attempt, the payment) and one counted read.
  await handle(w, tag(w, 201));
  assert.deepEqual([w.store.ops.swap, w.store.ops.read, w.store.ops.list], [5, 2, 0]);
  // asked about again once it is paid: neither.
  const again = tag(w, 202);
  await handle(w, again);
  await handle(w, again);
  await handle(w, again);
  assert.deepEqual([w.store.ops.swap, w.store.ops.read, w.store.ops.list], [7, 3, 0]);
  // a tag that is not to be paid: one of each. And housekeeping with nothing to do: neither.
  await handle(w, tag(w, ''));
  assert.deepEqual([w.store.ops.swap, w.store.ops.read], [8, 4]);
  for (let i = 0; i < 6; i++) {
    w.skip(10 * 60_000);
    await sweep(w);
  }
  assert.deepEqual([w.store.ops.swap, w.store.ops.read], [8, 4]);
});

await test('a node that remembers nothing, a cache that is behind, a book that is lost: still once', async () => {
  // the node never admits to having seen a transaction: the receipt is what says it is paid
  const w = world(1);
  w.chain.forgets = 1;
  const e = tag(w, 50);
  assert.equal((await handle(w, e)).state, 'sending');
  assert.equal(got(w, 50), SOL(0.02));
  w.skip(200_000);
  assert.equal((await handle(w, e)).state, 'paid');
  assert.equal((await handle(w, e)).state, 'paid');
  assert.equal(tries(w, e.id), 1);
  assert.equal(got(w, 50), SOL(0.02));
  assert.equal((await readBook(w.store)).rows[0].receipt, receiptOf(e.id));

  // the cheap look at the book shows it as it was before the tag was ever heard of
  const c = world(1);
  c.store.lag = true;
  const f = tag(c, 51);
  assert.equal((await handle(c, f)).state, 'paid');
  for (let i = 0; i < 3; i++) assert.equal((await handle(c, f)).state, 'paid');
  assert.equal(c.chain.handedIn.length, 1);
  assert.equal(got(c, 51), SOL(0.02));

  // the book is gone: the tag's receipt is still on the chain, and nothing is sent for it
  const l = world(1);
  const g = tag(l, 52);
  assert.equal((await handle(l, g)).state, 'paid');
  l.store.files.clear();
  const o = await handle(l, g);
  assert.equal(o.state, 'waiting');
  assert.match(o.state === 'waiting' ? o.why : '', /receipt is already in use/);
  assert.equal(l.chain.handedIn.length, 1);
  assert.equal(got(l, 52), SOL(0.02));

  // two books that know nothing of each other, one chain: both send, the chain lets one through
  const a = world(1);
  const b = { ...a, store: new MemoryStore() };
  const h = tag(a, 53);
  await Promise.all([handle(a, h), handle(b, h)]);
  a.skip(60_000);
  assert.equal(new Set(a.chain.handedIn).size, 2);
  assert.equal(got(a, 53), SOL(0.02));
  assert.equal(got(a, TREASURY.address), SOL(1) - SOL(0.02) - COST - FEE);
  assert.equal((await handle(a, h)).state, 'paid');
  assert.equal((await handle(b, h)).state, 'paid');
  assert.equal(got(a, 53), SOL(0.02));
});

await test('trouble asking the chain changes nothing that is in the book', async () => {
  const w = world(1);
  w.chain.landAfter = 100;
  const e = tag(w, 54);
  const first = await handle(w, e);
  assert.equal(first.state, 'sending');
  const account = w.chain.account;
  w.chain.account = async () => {
    throw new Error('getAccountInfo: the node answered 503');
  };
  const writes = w.store.ops.swap;
  const o = await handle(w, e);
  assert.deepEqual(o, first);
  assert.equal(w.store.ops.swap, writes);
  // a tag not heard of before is written down as waiting, with why, in words that give nothing away
  const fresh = await handle(w, tag(w, 55));
  assert.equal(fresh.state, 'waiting');
  assert.match(fresh.state === 'waiting' ? fresh.why : '', /could not be done just now \(getAccountInfo: the node answered 503\)/);
  w.chain.account = account;
  w.chain.landAfter = 2;
  w.skip(60_000);
  assert.equal((await sweep(w)).paid, 2);
  assert.equal(tries(w, e.id), 1);
  assert.deepEqual([got(w, 54), got(w, 55)], [SOL(0.02), SOL(0.02)]);
});

await test('rows left open by the version before this one are never paid by the machine', async () => {
  const w = world(1);
  const book: Book = { v: 1, since: new Date(w.now() - 3600_000).toISOString(), rows: [], tags: 3, paid: 1, paidLamports: 20_000_000, claims: [], claimedLamports: 0, claimNote: '' };
  const at = new Date(w.now() - 60_000).toISOString();
  const old = (id: string, state: string, extra: object = {}) => ({ id, ref: 'whatever-it-was', at, name: 'Sable', owner: 'Brick', wallet: wallet(56), state, ...extra });
  (book.rows as unknown[]).push(old('oldpaid00001', 'paid', { lamports: 20_000_000, signature: 'sigpaid' }), old('oldsending01', 'sending', { lamports: 20_000_000, signature: 'signeverlanded' }), old('oldwaiting01', 'waiting', { why: 'could not be done just now' }));
  w.store.put('ledger/book.json', JSON.stringify(book));
  const r = await sweep(w);
  assert.deepEqual([r.tried, r.paid], [2, 0]);
  assert.equal(w.chain.handedIn.length, 0);
  assert.equal(got(w, 56), 0n);
  const now = await readBook(w.store);
  assert.deepEqual(now.rows.map((x) => x.state).sort(), ['paid', 'skipped', 'skipped']);
  assert.ok(now.rows.every((x) => !('id' in x) && x.ref.length === 24));
  assert.match(now.rows.find((x) => x.state === 'skipped')?.why ?? '', /settled by hand/);
  // (asked for by the game server under its old id: the same answer, and still nothing sent)
  assert.equal((await handle(w, { id: 'oldsending01', at, name: 'Sable', owner: 'Brick', wallet: wallet(56) })).state, 'skipped');
  assert.equal(w.chain.handedIn.length, 0);
});

await test('whatever goes wrong, in whatever order: never twice, and in the end once', async () => {
  for (let round = 0; round < Number(process.env.ROUNDS ?? 150); round++) {
    const w = world(3, { PAYOUT_DAY_CAP_PERCENT: '100', PAYOUT_WALLET_DAY_TAGS: '1000' });
    const e = tag(w, 300 + round);
    let crashes = 3;
    const crash = () => {
      if (crashes > 0 && Math.random() < 0.04) {
        crashes--;
        throw new Error('cut off');
      }
    };
    w.store.before = crash;
    w.store.after = crash;
    for (let step = 0; step < 14; step++) {
      w.chain.lose = Math.random() < 0.35;
      w.chain.refuse = Math.random() < 0.15;
      w.chain.landAfter = 1 + Math.floor(Math.random() * 120);
      w.chain.failNext = Math.random() < 0.1;
      w.chain.forgets = Math.random() < 0.2 ? Math.random() : 0;
      w.store.lag = Math.random() < 0.3;
      const calls = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => handle(w, e).catch(() => null));
      await Promise.all(calls);
      w.skip(Math.random() < 0.5 ? 3000 : 95_000);
      assert.ok(got(w, 300 + round) <= SOL(0.06), 'paid more than once');
    }
    // the chain behaves from here on
    Object.assign(w.chain, { lose: false, refuse: false, landAfter: 2, failNext: false, forgets: 0 });
    w.store.before = w.store.after = () => {};
    w.store.lag = false;
    for (let i = 0; i < 8; i++) {
      await handle(w, e);
      w.skip(95_000);
    }
    const o = await handle(w, e);
    const t = tries(w, e.id);
    // one payment exactly, unless all five attempts were used up, in which case none
    if (o.state === 'paid') assert.equal(got(w, 300 + round), BigInt(o.lamports));
    else {
      assert.equal(t, 5, `left ${o.state}${'why' in o ? ': ' + o.why : ''} after ${t} attempts`);
      assert.equal(got(w, 300 + round), 0n);
    }
    assert.equal((await readBook(w.store)).paid, o.state === 'paid' ? 1 : 0);
  }
});

await test('a tag still owed is never dropped from the book, and the longest wait is seen to first', async () => {
  const w = world(0.015, { PAYOUT_DAY_CAP_PERCENT: '100' });
  const owed: Entry[] = [];
  for (const n of [60, 61, 62, 63]) {
    // (each cashed in a second after the last)
    w.skip(1000);
    owed.push(tag(w, n));
    assert.equal((await handle(w, owed[owed.length - 1])).state, 'waiting');
  }
  // far more settled ones after them than the book keeps
  for (let i = 0; i < 520; i++) {
    w.skip(1000);
    await handle(w, tag(w, ''));
  }
  const book = await readBook(w.store);
  assert.equal(book.tags, 524);
  assert.ok(book.rows.length <= 504);
  for (const e of owed) assert.ok(book.rows.some((r) => r.ref === refOf(e.id) && r.state === 'waiting'));
  // the money comes in: two at a time, the oldest two first
  w.chain.rewards = SOL(2);
  assert.deepEqual([(await sweep(w, 2)).paid, got(w, 60) > 0n, got(w, 61) > 0n, got(w, 62), got(w, 63)], [2, true, true, 0n, 0n]);
  assert.equal((await sweep(w, 2)).paid, 2);
  assert.ok(got(w, 62) > 0n && got(w, 63) > 0n);
  assert.equal((await sweep(w)).tried, 0);
});

await test('what the page is told', async () => {
  const w = world(10.01);
  w.chain.rewards = SOL(0.25);
  const s = await snapshot(w);
  assert.deepEqual([s.mode, s.treasury, s.balance, s.tagPays, s.waiting, s.problem, s.due, s.madeTheCoin], ['on', TREASURY.address, Number(SOL(10.01)), Number(SOL(0.2)), Number(SOL(0.25)), null, true, true]);
  // nothing in it, or in anything else that is written down, is the key
  const everything = JSON.stringify(s) + JSON.stringify(w.store.history) + JSON.stringify(w.cfg, (k, v) => (k === 'key' ? undefined : typeof v === 'bigint' ? String(v) : v));
  assert.ok(!everything.includes(KEY) && !everything.includes(Buffer.from(SEED).toString('hex')) && !everything.includes(b58(SEED)));
});

await test('the file store keeps its promises (the one in memory, here; the real one is asked the same on the site)', async () => {
  const r = await check(new MemoryStore(), 'ledger/check/t', async () => {});
  assert.equal(r['a file that is not there reads as nothing'], true);
  assert.deepEqual(r['and read straight back'], { n: 1, 'the same mark as the write gave': true });
  assert.equal(r['made a second time is refused'], true);
  assert.equal(r['of six making the same file at once, how many are told yes'], 1);
  assert.equal(r['and the change is what is read, at once'], true);
  assert.equal(r['a change by somebody holding the old mark is refused'], true);
  assert.equal(r['of six changing it at once from the same reading, how many win'], 1);
  assert.equal(r['seconds until a glance shows the latest change'], 0);
});

// ------------------------------------------------------------------ the second cut-over
//
// "we will pay .01 per tag now, but we wont pay out till the user is due for 5 tags" (the owner, 2026-10-13). Every
// world above stands before that moment, and is paid as it was promised. These stand after it.

const FIVE = { PAYOUT_RULES_FROM: '2026-10-01T00:00:00Z', PAYOUT_RULES2_FROM: '2026-10-02T00:00:00Z' };
/** (and with the wallet's three a day out of the way, where that is not what is being asked) */
const FIVES = { ...FIVE, PAYOUT_WALLET_DAY_TAGS: '1000' };
type W = ReturnType<typeof world>;
/** a wallet cashes in so many, a second apart: each, and what it was told */
const cash = async (w: W, to: number, count: number, over: Partial<Entry> = {}) => {
  const out: { e: Entry; o: Outcome }[] = [];
  for (let i = 0; i < count; i++) {
    w.skip(1000);
    const e = tag(w, to, over);
    out.push({ e, o: await handle(w, e) });
  }
  return out;
};
const have = (o: Outcome) => (o.state === 'waiting' ? [o.hold, o.have, o.need] : [o.state]);
const unwire = (wire: string) => Uint8Array.from(Buffer.from(wire, 'base64'));
/** a payment for these tags put together and signed outside the system, as somebody with the key and no book would */
const outside = async (w: W, to: number, es: Entry[]) => {
  const { blockhash } = await w.chain.latestBlockhash();
  const tx = signed(TREASURY, payment(TREASURY.publicKey, address(wallet(to)), es.map((e) => ({ ref: refOf(e.id), lamports: SOL(0.01) })), 20_000), blockhash);
  await w.chain.send(tx);
  w.skip(5000);
  return (await w.chain.statuses([tx.signature]))[0];
};
/**
 * Every payment that was ever written down as an attempt, read as the chain reads it: it makes a receipt for each
 * tag it names, for no more than five, and sends the one wallet exactly 0.01 for each receipt it makes.
 */
function everyAttempt(w: { store: MemoryStore }, es: Entry[], to: number) {
  const seen = new Set<string>();
  const receipts = new Map(es.map((e) => [receiptOf(e.id), refOf(e.id)]));
  for (const v of w.store.history) {
    if (v.path !== 'ledger/book.json') continue;
    for (const r of (JSON.parse(v.text) as Book).rows) {
      for (const x of r.tries ?? []) {
        if (seen.has(x.signature)) continue;
        seen.add(x.signature);
        const tx = parse(unwire(x.wire));
        assert.ok(tx.creates.length >= 1 && tx.creates.length <= LOT_MAX);
        assert.ok(tx.creates.every((c) => c.lamports === RENT && receipts.has(b58(c.at))));
        assert.deepEqual(tx.transfers.map((t) => [b58(t.to), t.lamports]), [[wallet(to), BigInt(tx.creates.length) * SOL(0.01)]]);
        assert.deepEqual(tx.memos, [`ZONA dog tag ${tx.creates.map((c) => receipts.get(b58(c.at))).join(' ')}`]);
      }
    }
  }
  return seen.size;
}

await test('the second cut-over, settings: 0.01 flat whatever the treasury holds, five at a time, and the moment', async () => {
  const c = config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: KEY, PAYOUT_RULES2_FROM: '2026-10-20T00:00:00Z' });
  assert.deepEqual([c.minTags, c.rules2From], [5, Date.parse('2026-10-20T00:00:00Z')]);
  // The moment is one named figure, RULES2_FROM, and what is set outside is asked before it. While neither is a
  // moment there is no second cut-over at all: a tag is paid as it was, whenever it is cashed in.
  const named = Date.parse(RULES2_FROM);
  assert.equal(config({}).rules2From, Number.isFinite(named) ? Math.max(config({}).rulesFrom, named) : Infinity);
  const never = config({ PAYOUT_RULES2_FROM: 'never' });
  assert.equal(never.rules2From, Infinity);
  // (and nothing that is not a moment written in full begins anything: a figure, a year, a day without its hour, a word)
  for (const said of ['1', '0', '2026', '2026-10-20', '2026-10-20 00:00', '2026-10-20T00:00:00', 'yes', 'on', 'now', 'Oct 20 2026']) assert.equal(config({ PAYOUT_RULES2_FROM: said }).rules2From, Infinity, `"${said}" was taken for a moment`);
  assert.equal(config({ PAYOUT_RULES2_FROM: ' 2026-10-20T00:00:00+02:00 ' }).rules2From, Date.parse('2026-10-19T22:00:00Z'));
  assert.equal(price(SOL(100.01), termsOf(never, '2030-01-01T00:00:00.000Z')), SOL(2));
  const after = new Date(c.rules2From).toISOString(), before = new Date(c.rules2From - 1).toISOString();
  for (const holds of [0, 0.44, 1.01, 100.01, 1000, 1_000_000]) assert.equal(price(SOL(holds), termsOf(c, after)), SOL(0.01));
  // the moment before it: as it was promised
  assert.equal(price(SOL(100.01), termsOf(c, before)), SOL(2));
  // nothing that is set for the share, or for the most a tag may pay, can make a full treasury pay more
  const greedy = config({ TAG_PAY_PERCENT: '25', TAG_PAY_MAX_SOL: '1000', PAYOUT_RULES2_FROM: '2026-10-20T00:00:00Z' });
  assert.equal(price(SOL(1000), termsOf(greedy, after)), SOL(0.01));
  assert.ok(price(SOL(1000), termsOf(greedy, before)) > SOL(200));
  // what can be set: the flat figure, how many, and the moment
  const set = config({ TAG_PAY_MIN_SOL: '0.02', PAYOUT_MIN_TAGS: '3', PAYOUT_RULES2_FROM: '2026-11-01T00:00:00Z' });
  assert.deepEqual([price(SOL(1000), termsOf(set, '2026-11-01T00:00:00.000Z')), set.minTags, set.rules2From], [SOL(0.02), 3, Date.parse('2026-11-01T00:00:00Z')]);
  // (never before the rules of 13 October, which it is built on)
  assert.equal(config({ PAYOUT_RULES2_FROM: '2026-01-01T00:00:00Z' }).rules2From, config({}).rulesFrom);
  // and the page is told what a tag cashed in now pays
  const s = await snapshot(world(100.01, FIVE));
  assert.deepEqual([s.fives, s.share, s.tagPays, s.floor, s.flatPay, s.minTags, s.rules2From], [true, 0, Number(SOL(0.01)), Number(SOL(0.01)), Number(SOL(0.01)), 5, '2026-10-02T00:00:00.000Z']);
});

await test('nothing is paid at four, and all five at five: one transaction, five receipts, 0.05 SOL, however full the treasury', async () => {
  const w = world(100.01, FIVES);
  const four = await cash(w, 400, 4);
  assert.deepEqual(four.map((x) => (x.o.state === 'waiting' ? x.o.why : x.o.state)), [1, 2, 3, 4].map((k) => `${k} of 5: paid when 5 of this wallet's tags are due`));
  assert.deepEqual(four.map((x) => have(x.o)), [1, 2, 3, 4].map((k) => ['five', k, 5]));
  assert.deepEqual([w.chain.handedIn.length, got(w, 400), got(w, TREASURY.address)], [0, 0n, SOL(100.01)]);
  assert.equal((await sweep(w)).tried, 0);
  const [fifth] = await cash(w, 400, 1);
  assert.equal(fifth.o.state, 'paid');
  const all = [...four, fifth].map((x) => x.e);
  assert.equal(got(w, 400), SOL(0.05));
  assert.equal(got(w, TREASURY.address), SOL(100.01) - SOL(0.05) - 5n * RENT - FEE);
  assert.equal(w.chain.handedIn.length, 1);
  // the one transaction: a receipt for each of the five, one sum to the wallet, and a note naming all five
  const [made] = attempts(w, fifth.e.id);
  const tx = parse(unwire(made.wire));
  assert.deepEqual(tx.creates.map((c) => [b58(c.at), c.lamports]), all.map((e) => [receiptOf(e.id), RENT]));
  assert.deepEqual(tx.transfers.map((t) => [b58(t.to), t.lamports]), [[wallet(400), SOL(0.05)]]);
  assert.deepEqual(tx.memos, [`ZONA dog tag ${all.map((e) => refOf(e.id)).join(' ')}`]);
  // (and it is within what a transaction may be: 1232 bytes)
  assert.equal(unwire(made.wire).length, 1205);
  const book = await readBook(w.store);
  const rows = all.map((e) => book.rows.find((r) => r.ref === refOf(e.id))!);
  assert.ok(rows.every((r) => r.state === 'paid' && r.lamports === 10_000_000 && r.signature === made.signature && r.rules === 2 && r.tries === undefined));
  assert.deepEqual(rows.map((r) => r.receipt), all.map((e) => receiptOf(e.id)));
  for (const e of all) assert.equal(got(w, receiptOf(e.id)), RENT);
  assert.deepEqual([book.paid, book.paidLamports, book.tags], [5, 50_000_000, 5]);
  // asked about again, each of them: paid, and nothing more is sent
  for (const e of all) assert.equal((await handle(w, e)).state, 'paid');
  assert.equal(w.chain.handedIn.length, 1);
});

await test('a sixth and a seventh wait to be counted again, and are paid with the tenth', async () => {
  const w = world(1, FIVES);
  await cash(w, 401, 5);
  assert.equal(got(w, 401), SOL(0.05));
  const more = await cash(w, 401, 4);
  assert.deepEqual(more.map((x) => have(x.o)), [1, 2, 3, 4].map((k) => ['five', k, 5]));
  assert.deepEqual([got(w, 401), w.chain.handedIn.length], [SOL(0.05), 1]);
  const [tenth] = await cash(w, 401, 1);
  assert.equal(tenth.o.state, 'paid');
  assert.deepEqual([got(w, 401), new Set(w.chain.handedIn).size, (await readBook(w.store)).paid], [SOL(0.1), 2, 10]);
  // somebody else's tags are nothing to do with it: each wallet is counted by itself
  const other = await cash(w, 499, 2);
  assert.deepEqual(other.map((x) => have(x.o)), [['five', 1, 5], ['five', 2, 5]]);
  // (and with the count set to one, each is paid as it comes, flat)
  const each = world(100.01, { ...FIVES, PAYOUT_MIN_TAGS: '1' });
  assert.deepEqual((await cash(each, 401, 2)).map((x) => x.o.state), ['paid', 'paid']);
  assert.equal(got(each, 401), SOL(0.02));
});

await test('a tag is never too old for having waited for the others: forty days, and more rows since than the book keeps', async () => {
  const w = world(1, FIVES);
  const four = await cash(w, 402, 4);
  const before = { ...w.store.ops };
  for (let d = 0; d < 40; d++) {
    w.skip(24 * 3600 * 1000);
    assert.equal((await sweep(w)).tried, 0);
  }
  // asked about meanwhile, by the game server or by the housekeeping: nothing is asked of the file service
  assert.deepEqual(have(await handle(w, four[0].e)), ['five', 4, 5]);
  assert.deepEqual([w.store.ops.read, w.store.ops.swap, w.chain.handedIn.length], [before.read, before.swap, 0]);
  // far more settled ones after them than the book keeps
  for (let i = 0; i < 510; i++) {
    w.skip(1000);
    await handle(w, tag(w, ''));
  }
  const book = await readBook(w.store);
  for (const x of four) assert.ok(book.rows.some((r) => r.ref === refOf(x.e.id) && r.state === 'waiting' && r.hold === 'five'));
  const [fifth] = await cash(w, 402, 1);
  assert.equal(fifth.o.state, 'paid');
  assert.equal(got(w, 402), SOL(0.05));
  // (one that COMES forty days late is still refused, as it always was)
  assert.equal((await handle(w, tag(w, 402, { at: new Date(w.now() - 40 * 24 * 3600 * 1000).toISOString() }))).state, 'skipped');
});

await test('across the cut-over the old book is closed: what was cashed in before it and is not paid by then is taken out and never paid; what was paid stays', async () => {
  // The owner, 2026-10-13: "i want to cancel all current pending payouts and move forward wihtour new payout
  // tracking system", and "all waiting and not paid tags on the payout screen will now be deleted entirely."
  // (the moment is half a day after this world begins. 0.025: one tag at the least, and what the treasury keeps back)
  const w = world(0.025, { PAYOUT_RULES_FROM: '2026-10-01T00:00:00Z', PAYOUT_RULES2_FROM: '2026-10-09T00:00:00Z', PAYOUT_WALLET_DAY_TAGS: '1000' });
  const old = await cash(w, 403, 3);
  assert.deepEqual(old.map((x) => have(x.o)), [['paid'], ['funds', undefined, undefined], ['funds', undefined, undefined]]);
  assert.equal(got(w, 403), SOL(0.01));
  // (and one that was never to be paid: it gave no wallet)
  assert.equal((await handle(w, tag(w, 403, { wallet: '' }))).state, 'skipped');
  let book = await readBook(w.store);
  assert.deepEqual([book.rows.length, book.tags], [4, 4]);
  // past the moment: what the same wallet cashes in now waits to be five, and the old ones are not among them
  w.skip(13 * 3600 * 1000);
  const fresh = await cash(w, 403, 4);
  assert.deepEqual(fresh.map((x) => have(x.o)), [1, 2, 3, 4].map((k) => ['five', k, 5]));
  // the treasury fills and the housekeeping runs: nothing of before is paid, and nothing of before that was not paid is left
  w.chain.balances.set(TREASURY.address, got(w, TREASURY.address) + SOL(5));
  w.skip(60_000);
  const sent = w.chain.handedIn.length;
  assert.equal((await sweep(w)).paid, 0);
  assert.equal(w.chain.handedIn.length, sent, 'something was sent for a tag of before the cut-over');
  book = await readBook(w.store);
  assert.deepEqual(book.rows.filter((r) => r.rules !== 2).map((r) => [r.ref, r.state]), [[refOf(old[0].e.id), 'paid']]);
  assert.deepEqual([book.rows.length, book.tags, book.paid], [5, 5, 1]);
  assert.equal(got(w, 403), SOL(0.01));
  // asked about again, as the game server asks: the answer is no, and nothing is written for it
  const again = await handle(w, old[1].e);
  assert.ok(again.state === 'skipped' && /before the payout rules changed/.test(again.why));
  // one cashed in before the moment and only handed over after it: the same
  const late = await handle(w, tag(w, 404, { at: '2026-10-08T23:59:59.000Z' }));
  assert.equal(late.state, 'skipped');
  assert.equal(got(w, 404), 0n);
  assert.equal(w.chain.handedIn.length, sent);
  book = await readBook(w.store);
  assert.deepEqual([book.rows.length, book.tags], [5, 5]);
  // the housekeeping again: nothing more to take out, and nothing is written
  const writes = w.store.ops.swap;
  w.skip(60_000);
  await sweep(w);
  assert.equal(w.store.ops.swap, writes, 'the book was written though nothing had changed');
  // the four new ones wait still; with the fifth they are paid 0.05, flat, though the treasury is full
  assert.equal(dueOf(book, wallet(403)).length, 4);
  const [fifth] = await cash(w, 403, 1);
  assert.equal(fifth.o.state, 'paid');
  assert.equal(got(w, 403), SOL(0.01) + SOL(0.05));

  // A payment of before that is on its way when the moment comes is followed to its end. If it arrives, the tag is paid.
  const CUT = { PAYOUT_RULES_FROM: '2026-10-01T00:00:00Z', PAYOUT_RULES2_FROM: '2026-10-08T12:00:20Z', PAYOUT_WALLET_DAY_TAGS: '1000' };
  const u = world(1, CUT);
  u.chain.lose = true;
  const lands = tag(u, 411);
  assert.equal((await handle(u, lands)).state, 'sending');
  u.chain.lose = false;
  u.skip(30_000);
  await sweep(u);
  u.skip(5000);
  await sweep(u);
  book = await readBook(u.store);
  assert.deepEqual(book.rows.map((r) => r.state), ['paid']);
  assert.ok(got(u, 411) >= SOL(0.01) && got(u, 411) === BigInt(book.rows[0].lamports!), 'it was not paid what its one attempt set out to pay');
  assert.equal(tries(u, lands.id), 1);
  // And if it is seen to be lost, no other is made for it, and the tag is taken out.
  const x = world(1, CUT);
  x.chain.lose = true;
  const lost = tag(x, 410);
  assert.equal((await handle(x, lost)).state, 'sending');
  x.chain.lose = false;
  x.skip(100_000);
  await sweep(x);
  book = await readBook(x.store);
  assert.deepEqual([book.rows.length, book.tags], [0, 0]);
  assert.equal(tries(x, lost.id), 1);
  assert.equal(got(x, 410), 0n);
  x.skip(120_000);
  await sweep(x);
  assert.equal(got(x, 410), 0n);

  // And a tag the book already held when the moment was set is of before it, wherever the moment is put: in this
  // world every tag is after it, and this one was written down by the code before. It is taken out, and not paid.
  const v = world(0.015, FIVES);
  const at = new Date(v.now() - 60_000).toISOString();
  book = { v: 1, since: new Date(v.now() - 3600_000).toISOString(), rows: [], tags: 1, paid: 0, paidLamports: 0, claims: [], claimedLamports: 0, claimNote: '' };
  book.rows.push({ ref: refOf('heldbefore001'), at, name: 'Sable', owner: 'Brick', wallet: wallet(405), state: 'waiting', why: 'the treasury is too low: paid when the next creator rewards come in', hold: 'funds', heldOn: at.slice(0, 10) });
  v.store.put('ledger/book.json', JSON.stringify(book));
  v.chain.rewards = SOL(2);
  v.skip(60_000);
  assert.equal((await sweep(v)).paid, 0);
  book = await readBook(v.store);
  assert.deepEqual([book.rows.length, book.tags], [0, 0]);
  assert.equal(got(v, 405), 0n);
});

await test("the wallet's three a day still holds: a fourth that day is not paid and is not counted, and five take two days", async () => {
  const w = world(1, FIVE);
  const one = await cash(w, 406, 4);
  assert.deepEqual(one.map((x) => have(x.o)), [['five', 1, 5], ['five', 2, 5], ['five', 3, 5], ['skipped']]);
  assert.match(one[3].o.state === 'skipped' ? one[3].o.why : '', /had cashed in 3 tags already that day/);
  w.skip(13 * 3600 * 1000);
  const two = await cash(w, 406, 2);
  assert.deepEqual(two.map((x) => have(x.o)), [['five', 4, 5], ['paid']]);
  assert.equal(got(w, 406), SOL(0.05));
  // the one that was over is not paid now either; the third of the second day is the first of the next five; a fourth is over
  assert.equal((await handle(w, one[3].e)).state, 'skipped');
  const three = await cash(w, 406, 2);
  assert.deepEqual(three.map((x) => have(x.o)), [['five', 1, 5], ['skipped']]);
  const rows = (await readBook(w.store)).rows.filter((r) => r.wallet === wallet(406));
  assert.deepEqual(['paid', 'skipped', 'waiting'].map((s) => rows.filter((r) => r.state === s).length), [5, 2, 1]);
  assert.deepEqual([got(w, 406), w.chain.handedIn.length], [SOL(0.05), 1]);
  // four cashed in at the very same moment: three are counted and one is not, whichever way they come to be written down
  const d = world(1, FIVE);
  await Promise.all([tag(d, 407), tag(d, 407), tag(d, 407), tag(d, 407)].map((e) => handle(d, e)));
  const same = (await readBook(d.store)).rows.filter((r) => r.wallet === wallet(407));
  assert.deepEqual([same.filter((r) => r.state === 'waiting' && r.hold === 'five').length, same.filter((r) => r.state === 'skipped').length], [3, 1]);
});

await test('a traded tag is not paid, and is not counted toward the five', async () => {
  const w = world(1, FIVES);
  await cash(w, 408, 4, { name: 'Ann', owner: 'Cy' });
  // Bob cashes Ann's tag: one of his five, when he has them. Ann then cashes Bob's: not paid, and not one of hers.
  assert.deepEqual(have((await cash(w, 409, 1, { name: 'Bob', owner: 'Ann' }))[0].o), ['five', 1, 5]);
  const [back] = await cash(w, 408, 1, { name: 'Ann', owner: 'Bob' });
  assert.equal(back.o.state, 'skipped');
  assert.match(back.o.state === 'skipped' ? back.o.why : '', /cashed each other's tags inside a day/);
  assert.deepEqual([got(w, 408), w.chain.handedIn.length, dueOf(await readBook(w.store), wallet(408)).length], [0n, 0, 4]);
  // her next honest one is the fifth: five are paid, not six
  const [fifth] = await cash(w, 408, 1, { name: 'Ann', owner: 'Dee' });
  assert.equal(fifth.o.state, 'paid');
  assert.equal(got(w, 408), SOL(0.05));
});

await test('what five tags cost the file service: a write each as they come, and two for the payment of all five', async () => {
  const w = world(1, FIVES);
  const ops = () => [w.store.ops.swap, w.store.ops.read, w.store.ops.list];
  const four = await cash(w, 410, 4);
  // (the first tag there ever is also has the book note when payouts began)
  assert.deepEqual(ops(), [5, 4, 0]);
  // asked about again while they wait, by the game server and by the housekeeping: nothing is read or written, and
  // the game server is told there is nothing to ask about again
  for (let i = 0; i < 5; i++) for (const x of four) assert.equal(((o: Outcome) => o.state === 'waiting' && o.parked)(await handle(w, x.e)), true);
  for (let i = 0; i < 6; i++) {
    w.skip(10 * 60_000);
    assert.equal((await sweep(w)).tried, 0);
  }
  assert.deepEqual([...ops(), w.chain.handedIn.length], [5, 4, 0, 0]);
  // the fifth: the attempt (which is also where the fifth is first written down), and the payment of all five
  await cash(w, 410, 1);
  assert.deepEqual(ops(), [7, 5, 0]);
  assert.equal(got(w, 410), SOL(0.05));
  // So: six writes for five tags paid. Paid one at a time they are ten (see "what one payment costs the file service").
  await cash(w, 410, 5);
  assert.deepEqual(ops(), [13, 10, 0]);
  assert.equal(got(w, 410), SOL(0.1));
});

await test('the five sent twice, and signed again: the chain takes them once, and none of them in part', async () => {
  const w = world(1, FIVES);
  const es = (await cash(w, 420, 5)).map((x) => x.e);
  const [made] = attempts(w, es[4].id);
  const before = [got(w, 420), got(w, TREASURY.address)];
  assert.equal(before[0], SOL(0.05));
  // the very same transaction handed in again: nothing
  await w.chain.send({ wire: unwire(made.wire), signature: made.signature });
  w.skip(5000);
  assert.deepEqual([got(w, 420), got(w, TREASURY.address)], before);
  // signed afresh for the same five: it gets in, fails as a whole, and costs its fee
  assert.ok((await outside(w, 420, es))?.err);
  assert.deepEqual([got(w, 420), got(w, TREASURY.address)], [before[0], before[1] - FEE]);
  // four tags never paid, in one transaction with one that has been: the four are not paid either
  const fresh = [tag(w, 420), tag(w, 420), tag(w, 420), tag(w, 420)];
  assert.ok((await outside(w, 420, [...fresh, es[2]]))?.err);
  assert.equal(got(w, 420), SOL(0.05));
  for (const e of fresh) assert.equal(got(w, receiptOf(e.id)), 0n);
  // (the four by themselves go through: it was the fifth that stopped them)
  assert.equal((await outside(w, 420, fresh))?.err, null);
  assert.equal(got(w, 420), SOL(0.09));
  // and no payment is ever put together for more tags than a transaction carries, or for the same tag twice
  assert.throws(() => payment(TREASURY.publicKey, address(wallet(420)), [...es, fresh[0]].map((e) => ({ ref: refOf(e.id), lamports: SOL(0.01) })), 20_000));
  assert.throws(() => payment(TREASURY.publicKey, address(wallet(420)), [es[0], es[0]].map((e) => ({ ref: refOf(e.id), lamports: SOL(0.01) })), 20_000));
});

await test('five: asked three times at once, and three of them cashed in at the same moment', async () => {
  // the fifth, asked about three times at once
  const w = world(1, FIVES);
  const four = await cash(w, 421, 4);
  w.skip(1000);
  const e = tag(w, 421);
  await Promise.all([handle(w, e), handle(w, e), handle(w, e)]);
  w.skip(5000);
  for (const x of [...four.map((y) => y.e), e, e, e]) assert.equal((await handle(w, x)).state, 'paid');
  assert.deepEqual([got(w, 421), new Set(w.chain.handedIn).size, tries(w, e.id), (await readBook(w.store)).paid], [SOL(0.05), 1, 1, 5]);
  // the third, fourth and fifth at the same moment: each is counted before the others are written down, and whichever
  // is written last finds five and sees to them: nobody has to ask again
  const v = world(1, FIVES);
  await cash(v, 422, 2);
  v.skip(1000);
  const three = [tag(v, 422), tag(v, 422), tag(v, 422)];
  await Promise.all(three.map((x) => handle(v, x)));
  assert.equal(got(v, 422), SOL(0.05));
  for (const x of three) assert.equal((await handle(v, x)).state, 'paid');
  assert.deepEqual([got(v, 422), new Set(v.chain.handedIn).size, (await readBook(v.store)).paid], [SOL(0.05), 1, 5]);
  // two books that know nothing of each other, one chain: both send the five, and the chain lets one through
  const a = world(1, FIVES);
  const b = { ...a, store: new MemoryStore() };
  const es: Entry[] = [];
  for (let i = 0; i < 4; i++) {
    a.skip(1000);
    es.push(tag(a, 423));
    await handle(a, es[i]);
    await handle(b, es[i]);
  }
  a.skip(1000);
  es.push(tag(a, 423));
  await Promise.all([handle(a, es[4]), handle(b, es[4])]);
  a.skip(60_000);
  assert.equal(new Set(a.chain.handedIn).size, 2);
  assert.deepEqual([got(a, 423), got(a, TREASURY.address)], [SOL(0.05), SOL(1) - SOL(0.05) - 5n * RENT - 2n * FEE]);
  for (const x of es) assert.deepEqual([(await handle(a, x)).state, (await handle(b, x)).state], ['paid', 'paid']);
  assert.equal(got(a, 423), SOL(0.05));
});

await test('one of the five already paid by an earlier attempt: it is not paid again, and the other four are paid once', async () => {
  const w = world(1, FIVES);
  const four = await cash(w, 424, 4);
  w.chain.lose = true;
  const [fifth] = await cash(w, 424, 1);
  assert.equal(fifth.o.state, 'sending');
  w.chain.lose = false;
  const es = [...four, fifth].map((x) => x.e);
  // while the five are on their way (as far as the book knows), one of them is paid by itself from somewhere else
  assert.equal((await outside(w, 424, [es[2]]))?.err, null);
  assert.equal(got(w, 424), SOL(0.01));
  // the five as they were signed cannot arrive now: handed in again, they fail as a whole
  const [made] = attempts(w, es[0].id);
  await w.chain.send({ wire: unwire(made.wire), signature: made.signature });
  w.skip(5000);
  assert.equal(got(w, 424), SOL(0.01));
  // looked at again: the one is known by its receipt, and the four are paid together once the old attempt is dead
  for (let i = 0; i < 3; i++) {
    w.skip(100_000);
    await sweep(w);
  }
  for (const e of es) assert.equal((await handle(w, e)).state, 'paid');
  assert.equal(got(w, 424), SOL(0.05));
  for (const e of es) assert.equal(got(w, receiptOf(e.id)), RENT);
  const book = await readBook(w.store);
  assert.deepEqual([book.paid, book.paidLamports], [5, 50_000_000]);
  assert.deepEqual(parse(unwire(attempts(w, es[0].id)[1].wire)).transfers.map((t) => t.lamports), [SOL(0.04)]);

  // one of four that are waiting has a receipt on the chain already, and nothing in the book to say it is ours: it is
  // left for a person, the fifth makes four, and nothing is sent until there are five without it
  const v = world(1, FIVES);
  const first = await cash(v, 425, 4);
  v.chain.balances.set(receiptOf(first[1].e.id), RENT);
  const [next] = await cash(v, 425, 1);
  assert.deepEqual([have(next.o), v.chain.handedIn.length], [['five', 4, 5], 0]);
  assert.equal((await readBook(v.store)).rows.find((r) => r.ref === refOf(first[1].e.id))?.hold, 'hand');
  assert.equal((await cash(v, 425, 1))[0].o.state, 'paid');
  assert.equal(got(v, 425), SOL(0.05));
});

await test('more than five due: paid in as many transactions as it takes, each whole; and one of them lost is made again for the same tags', async () => {
  // (a treasury too low for five: they are due, and wait for it, and a sixth and a seventh join them)
  const w = world(0.02, FIVES);
  const seven = await cash(w, 427, 7);
  assert.deepEqual(seven.map((x) => have(x.o)[0]), ['five', 'five', 'five', 'five', 'funds', 'funds', 'funds']);
  assert.deepEqual([w.chain.handedIn.length, dueOf(await readBook(w.store), wallet(427)).length], [0, 7]);
  // while the treasury stays low, nothing is asked of the file service about them
  const before = { ...w.store.ops };
  w.skip(10 * 60_000);
  assert.equal((await sweep(w)).tried, 0);
  assert.deepEqual([w.store.ops.read, w.store.ops.swap], [before.read, before.swap]);
  // the money comes: five and two, and the two are lost on their way
  w.chain.balances.set(TREASURY.address, got(w, TREASURY.address) + SOL(1));
  let healed = false;
  const send = w.chain.send.bind(w.chain);
  w.chain.send = async (tx) => {
    w.chain.lose = !healed && parse(tx.wire).creates.length === 2;
    await send(tx).finally(() => (w.chain.lose = false));
  };
  w.skip(60_000);
  assert.equal((await sweep(w)).paid, 5);
  assert.equal(got(w, 427), SOL(0.05));
  assert.deepEqual(seven.map((x) => tries(w, x.e.id)), [1, 1, 1, 1, 1, 1, 1]);
  // half a minute on the two could still turn up: nothing new is signed
  w.skip(30_000);
  await sweep(w);
  assert.equal(tries(w, seven[6].e.id), 1);
  // past their last block: made again, for those two and no others
  w.skip(100_000);
  healed = true;
  assert.equal((await sweep(w)).paid, 2);
  assert.equal(got(w, 427), SOL(0.07));
  assert.deepEqual(seven.map((x) => tries(w, x.e.id)), [1, 1, 1, 1, 1, 2, 2]);
  assert.equal(everyAttempt(w, seven.map((x) => x.e), 427), 3);
  assert.equal(got(w, TREASURY.address), SOL(0.02) + SOL(1) - SOL(0.07) - 7n * RENT - 2n * FEE);
  assert.equal((await readBook(w.store)).paid, 7);
});

await test("the day's limit falling inside five: none of them is paid until there is room for all of them", async () => {
  // (twelve per cent of 1 SOL a day: room for two fives, and not for a third)
  const w = world(1, { ...FIVES, PAYOUT_DAY_CAP_PERCENT: '12' });
  await cash(w, 430, 5);
  await cash(w, 431, 5);
  assert.deepEqual([got(w, 430), got(w, 431)], [SOL(0.05), SOL(0.05)]);
  const third = await cash(w, 432, 5);
  assert.equal(third[4].o.state, 'waiting');
  assert.match(third[4].o.state === 'waiting' ? third[4].o.why : '', /today's limit on what leaves the treasury/);
  assert.deepEqual([got(w, 432), new Set(w.chain.handedIn).size], [0n, 2]);
  assert.ok((await readBook(w.store)).rows.filter((r) => r.wallet === wallet(432)).every((r) => r.state === 'waiting' && r.hold === 'day'));
  // asked about again the same day, with nothing changed: nothing is asked of the file service, and nothing is sent
  const before = { ...w.store.ops };
  for (const x of third) assert.equal((await handle(w, x.e)).state, 'waiting');
  assert.equal((await sweep(w)).tried, 0);
  assert.deepEqual([w.store.ops.read, w.store.ops.swap, new Set(w.chain.handedIn).size], [before.read, before.swap, 2]);
  // a sixth joins them, and waits with them; the day after, all six are paid
  assert.deepEqual(have((await cash(w, 432, 1))[0].o)[0], 'day');
  w.skip(13 * 3600 * 1000);
  assert.equal((await sweep(w)).paid, 6);
  assert.equal(got(w, 432), SOL(0.06));
});

await test('a dry run of five tries the one transaction and sends nothing', async () => {
  const dry = world(1, { ...FIVES, PAYOUTS: 'dry', TREASURY_SECRET_KEY: '', TREASURY_ADDRESS: TREASURY.address });
  const five = await cash(dry, 433, 5);
  assert.deepEqual(five.slice(0, 4).map((x) => have(x.o)[0]), ['five', 'five', 'five', 'five']);
  assert.match(five[4].o.state === 'waiting' ? five[4].o.why : '', /dry run: would pay 0.01 SOL, with 4 more in one transaction \(tried, and it would go through\)/);
  assert.deepEqual([dry.chain.handedIn.length, got(dry, 433)], [0, 0n]);
});

await test('five and more of one wallet, whatever goes wrong, in whatever order: none paid twice, none in part, and in the end each once', async () => {
  for (let round = 0; round < Number(process.env.ROUNDS ?? 150) / 2; round++) {
    const w = world(3, { ...FIVES, PAYOUT_DAY_CAP_PERCENT: '100' });
    const to = 2000 + round;
    const count = 5 + Math.floor(Math.random() * 6);
    const es: Entry[] = [];
    let crashes = 3;
    const crash = () => {
      if (crashes > 0 && Math.random() < 0.03) {
        crashes--;
        throw new Error('cut off');
      }
    };
    w.store.before = crash;
    w.store.after = crash;
    const receipts = () => es.filter((e) => got(w, receiptOf(e.id)) > 0n).length;
    // what the wallet holds is 0.01 for each receipt there is: never more than its tags, and never a part of a payment
    const whole = () => assert.equal(got(w, to), BigInt(receipts()) * SOL(0.01), 'the wallet does not hold exactly 0.01 for each receipt');
    for (let step = 0; step < 16; step++) {
      w.chain.lose = Math.random() < 0.3;
      w.chain.refuse = Math.random() < 0.15;
      w.chain.landAfter = 1 + Math.floor(Math.random() * 120);
      w.chain.failNext = Math.random() < 0.1;
      w.chain.forgets = Math.random() < 0.2 ? Math.random() : 0;
      w.store.lag = Math.random() < 0.3;
      // a new tag or two while there are any to come, questions about the old ones, and the housekeeping: all at once
      const calls: Promise<unknown>[] = [];
      for (let k = 0; k < 2 && es.length < count; k++) {
        if (Math.random() < 0.3) continue;
        es.push(tag(w, to));
        calls.push(handle(w, es[es.length - 1]).catch(() => null));
      }
      for (const e of es) if (Math.random() < 0.3) calls.push(handle(w, e).catch(() => null));
      if (Math.random() < 0.3) calls.push(sweep(w).catch(() => null));
      await Promise.all(calls);
      w.skip(Math.random() < 0.5 ? 3000 : 95_000);
      whole();
    }
    // the chain behaves from here on, and the game server asks about every one of them as it would
    Object.assign(w.chain, { lose: false, refuse: false, landAfter: 2, failNext: false, forgets: 0 });
    w.store.before = w.store.after = () => {};
    w.store.lag = false;
    while (es.length < count) es.push(tag(w, to));
    for (let i = 0; i < 8; i++) {
      for (const e of es) await handle(w, e);
      await sweep(w);
      w.skip(95_000);
      whole();
    }
    const book = await readBook(w.store);
    const rows = es.map((e) => book.rows.find((r) => r.ref === refOf(e.id)));
    const paid = rows.filter((r) => r?.state === 'paid').length;
    assert.deepEqual([got(w, to), receipts(), book.paid, book.paidLamports], [BigInt(paid) * SOL(0.01), paid, paid, paid * 10_000_000]);
    // each is paid; or its five attempts were used up; or it is one of fewer than five that wait for the rest
    rows.forEach((r, i) => assert.ok(r && (r.state === 'paid' || (r.state === 'waiting' && (r.hold === 'five' || (r.hold === 'hand' && tries(w, es[i].id) === 5)))), `left ${r?.state} ${r?.hold ?? ''}: ${r?.why ?? ''}`));
    assert.ok(rows.filter((r) => r!.state === 'waiting' && r!.hold === 'five').length < 5, 'five were due and were not paid');
    everyAttempt(w, es, to);
  }
});

await test('what people are told: the page before and after the moment, one line a wallet until it is paid, and the game server not kept asking', async () => {
  const w = world(1, { PAYOUT_RULES_FROM: '2026-10-01T00:00:00Z', PAYOUT_RULES2_FROM: '2026-10-09T00:00:00Z', PAYOUT_WALLET_DAY_TAGS: '1000' });
  const page = async () => (await show(new Request('https://site.test/payouts'), w)).text();
  const status = async () => (await (await show(new Request('https://site.test/payouts?format=status'), w)).json()) as { tagPays: number; share: number; floor: number; minTags: number; next: unknown };
  const says = (html: string, wants: string[]) => wants.forEach((want) => assert.ok(html.includes(want), `the page does not say "${want}"`));
  // ---- with no moment set: nothing is different and nothing is said, long after any moment there might have been
  const unset = world(1, { PAYOUT_RULES_FROM: '2026-10-01T00:00:00Z', PAYOUT_RULES2_FROM: 'never' });
  unset.skip(400 * 24 * 3600 * 1000);
  assert.deepEqual((await cash(unset, 439, 2)).map((x) => x.o.state), ['paid', 'paid']);
  const plain = await (await show(new Request('https://site.test/payouts'), unset)).text();
  assert.ok(plain.includes('2% of the treasury, 0.01 at least') && plain.split('<h3>What chang').length - 1 === 1 && !plain.includes('are due'));
  assert.deepEqual(((x: { share: number; minTags: number; next: unknown }) => [x.share, x.minTags, x.next])(await (await show(new Request('https://site.test/payouts?format=status'), unset)).json()), [0.02, 1, null]);
  // ---- before the moment: as it is, and what is to change, with the figures of the settings
  await cash(w, 440, 1);
  says(await page(), ['2% of the treasury, 0.01 at least', 'What changes on 9 October 2026', 'From 00:00 UTC a tag pays 0.01 SOL flat', 'a wallet is paid when 5 of its tags are due, for all of them at once (0.05 SOL for 5)', 'What changed on 13 October 2026']);
  let s = await status();
  assert.deepEqual([s.share, s.floor, s.minTags, s.next], [0.02, 0.01, 1, { from: '2026-10-09T00:00:00.000Z', tagPays: 0.01, minTags: 5 }]);
  assert.ok(s.tagPays > 0.019);
  // ---- after it
  w.skip(13 * 3600 * 1000);
  await cash(w, 440, 3, { name: 'Threetags' });
  await cash(w, 441, 1, { name: 'Onetag' });
  let html = await page();
  says(html, ['What changed on 9 October 2026', 'Paid when 5 are due', 'flat, whatever the treasury holds: paid when a wallet has 5 due', '<td>3 tags</td>', '>3 of 5</em>', '>1 of 5</em>', '0.05 SOL</b> <i>when 5 are due</i>', 'Threetags', 'Onetag']);
  // one line a wallet, though four tags wait; and every one of the four is in the totals
  assert.equal(html.split('data-s="open"').length - 1, 2);
  says(html, ['Waiting 4</button>', '<b>4</b><span>tags on their way or waiting</span>', '4 of them, 0.04 SOL, owed to 2 wallets that are paid at 5 due', 'All 5</button>']);
  // (nothing is on its way and nothing can be done: the page does not call the housekeeping)
  assert.ok(!html.includes("fetch('/api/tick')"));
  s = await status();
  assert.deepEqual([s.tagPays, s.share, s.floor, s.minTags, s.next], [0.01, 0, 0.01, 5, null]);
  const json = async () => (await (await show(new Request('https://site.test/payouts?format=json'), w)).json()) as { tags: number; paid: number; owed: unknown; rows: Record<string, unknown>[] };
  let data = await json();
  assert.deepEqual([data.tags, data.paid, data.owed], [5, 1, { tags: 4, wallets: 2, sol: 0.04 }]);
  const waiting = data.rows.filter((r) => r.state === 'waiting');
  assert.deepEqual(waiting.map((r) => [r.name, r.tags, r.have, r.need, r.pays, r.why, r.hold, 'ref' in r]), [['Onetag', 1, 1, 5, 50_000_000, '1 of 5: paid when 5 are due', 'five', false], ['Threetags', 3, 3, 5, 50_000_000, '3 of 5: paid when 5 are due', 'five', false]]);
  assert.ok(!JSON.stringify(data).includes('"tries"'));
  // ---- the game server: told "4 of 5" when a tag comes, and given nothing to keep asking about
  const known = new Map<string, Entry>();
  const game = http.createServer((req, res) => {
    const e = known.get((req.url ?? '').split('/')[2]);
    res.writeHead(e ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(e ?? {}));
  });
  await new Promise<void>((done) => game.listen(0, '127.0.0.1', done));
  const ask = async (e: Entry) => (await (await record(new Request(`https://site.test/api/cashin?id=${e.id}`, { method: 'POST' }), w, `http://127.0.0.1:${(game.address() as { port: number }).port}`)).json()) as { ok: boolean; payout?: Outcome; parked?: Outcome };
  w.skip(1000);
  const fourth = tag(w, 440, { name: 'Threetags' });
  known.set(fourth.id, fourth);
  const told = await ask(fourth);
  assert.deepEqual([told.payout?.state, told.payout?.state === 'waiting' && told.payout.why], ['waiting', "4 of 5: paid when 5 of this wallet's tags are due"]);
  const again = await ask(fourth);
  assert.deepEqual(['payout' in again, again.parked && have(again.parked)], [false, ['five', 4, 5]]);
  // the fifth: paid, and said so; and the line gives way to the five paid entries, each with the transaction
  w.skip(1000);
  const fifth = tag(w, 440, { name: 'Threetags' });
  known.set(fifth.id, fifth);
  assert.deepEqual(((p?: Outcome) => [p?.state, p?.state === 'paid' && p.lamports])((await ask(fifth)).payout), ['paid', 10_000_000]);
  game.close();
  html = await page();
  assert.equal(html.split('of 5</em>').length - 1, 1);
  assert.equal(html.split('<em class="c paid">Paid</em>').length - 1, 6);
  assert.equal(html.split('data-s="open"').length - 1, 1);
  data = await json();
  assert.deepEqual([data.paid, data.owed, data.rows.filter((r) => r.state === 'paid' && r.signature && r.receipt).length], [6, { tags: 1, wallets: 1, sol: 0.01 }, 6]);
  // ---- more due than five, held for the treasury: one line still, saying how many and how much and why
  const low = world(0.02, FIVES);
  await cash(low, 442, 7);
  says(await (await show(new Request('https://site.test/payouts'), low)).text(), ['>7 due</em>', '0.07 SOL</b> <i>for 7 tags: the treasury is too low', '<b>7</b><span>tags on their way or waiting</span>']);
  const held = ((await (await show(new Request('https://site.test/payouts?format=json'), low)).json()) as { rows: Record<string, unknown>[] }).rows;
  assert.deepEqual(held.map((r) => [r.tags, r.pays, r.hold, String(r.why).slice(0, 31)]), [[7, 70_000_000, 'funds', '7 due: the treasury is too low:']]);
});

// ------------------------------------------------------------------ three faults, mended before the rule is switched on
//
// Found by an independent reading of the second cut-over on 2026-10-13, and mended that day, before any moment was
// set for it ("yes fix those 3 then turn it on with the map release"). Every one of these failed on the code as it
// was. The first two are one fault (a tag stranded by its age), the third is the trade rule, the last two are the
// rule of five's own: a pack that cannot be afforded, and the way back.

const DAY = 24 * 3600 * 1000;
const ON = { PAYOUTS: 'on', TREASURY_SECRET_KEY: KEY };
const rowsOf = async (w: W, es: Entry[]) => {
  const book = await readBook(w.store);
  return es.map((e) => book.rows.find((r) => r.ref === refOf(e.id))!);
};
const nodeDown = async () => {
  throw new Error('getAccountInfo: the node answered 503');
};

await test('five that waited, and whose turn came when payouts were not set up to pay, are paid when they are: however old, all five, once', async () => {
  // (0.02 SOL: not enough for five. They are due, and wait for the treasury)
  const w = world(0.02, FIVES);
  const five = (await cash(w, 450, 5)).map((x) => x.e);
  assert.ok((await rowsOf(w, five)).every((r) => r.state === 'waiting' && r.hold === 'funds'));
  // five days on the money comes, at a moment when the chain cannot say who made the coin: nothing is paid, and each
  // of the five is written down as waiting for payouts to be set up to pay
  w.skip(5 * DAY);
  w.chain.balances.set(TREASURY.address, got(w, TREASURY.address) + SOL(1));
  w.coinState = { ...w.coinState, creator: null };
  assert.equal((await sweep(w)).paid, 0);
  assert.ok((await rowsOf(w, five)).every((r) => r.state === 'waiting' && r.hold === 'setup'));
  assert.equal(w.chain.handedIn.length, 0);
  // the chain answers again: they are five still, they are looked at though they are five days old, and they are paid
  w.coinState = { ...w.coinState, creator: TREASURY.publicKey };
  w.skip(10 * 60_000);
  assert.equal((await sweep(w)).paid, 5, 'five that were owed were left where they were, for being more than four days old');
  assert.deepEqual([got(w, 450), new Set(w.chain.handedIn).size, (await readBook(w.store)).paid], [SOL(0.05), 1, 5]);
  assert.equal(everyAttempt(w, five, 450), 1);
  w.skip(10 * 60_000);
  assert.equal((await sweep(w)).tried, 0);

  // And five whose turn came on a dry run, switched on five days later: the same. (Payouts had been on before the
  // dry run, so the book has its beginning: what is cashed in before payouts were ever on is listed and no more.)
  const d = world(1, FIVES);
  const first = await cash(d, 451, 1);
  d.cfg = config({ ...FIVES, PAYOUTS: 'dry', TREASURY_SECRET_KEY: '', TREASURY_ADDRESS: TREASURY.address });
  const rest = await cash(d, 451, 4);
  assert.match(rest[3].o.state === 'waiting' ? rest[3].o.why : '', /dry run: would pay 0.01 SOL, with 4 more in one transaction/);
  const tried = [...first, ...rest].map((x) => x.e);
  assert.ok((await rowsOf(d, tried)).every((r) => r.state === 'waiting' && r.hold === 'setup'));
  // (while it is a dry run nothing more is asked about them, by anybody)
  const before = { ...d.store.ops };
  d.skip(5 * DAY);
  assert.equal((await sweep(d)).tried, 0);
  assert.deepEqual([d.store.ops.read, d.store.ops.swap], [before.read, before.swap]);
  d.cfg = config({ ...FIVES, ...ON });
  assert.equal((await sweep(d)).paid, 5, 'five whose turn came on a dry run were never paid once payouts were on');
  assert.deepEqual([got(d, 451), new Set(d.chain.handedIn).size], [SOL(0.05), 1]);

  // And the key of the wrong wallet given, for five days, as a fifth comes: the fifth waits for the right key and is
  // one of the five still, the four are left as they are (nothing is asked of the file service about any of them,
  // and nothing written, in all that time), and with the right key all five are paid.
  const k = world(1, FIVES);
  const four = (await cash(k, 455, 4)).map((x) => x.e);
  k.coinState = { ...k.coinState, creator: address(wallet(998)) };
  const [late] = await cash(k, 455, 1);
  assert.equal(have(late.o)[0], 'setup');
  // (the housekeeping says once, in the book, that the rewards cannot be collected with this key)
  assert.equal((await sweep(k)).tried, 0);
  const quiet = { ...k.store.ops };
  for (let i = 0; i < 5; i++) {
    k.skip(DAY);
    assert.equal((await sweep(k)).tried, 0);
  }
  assert.deepEqual([k.store.ops.read, k.store.ops.swap], [quiet.read, quiet.swap]);
  assert.deepEqual((await rowsOf(k, [...four, late.e])).map((r) => r.hold), ['five', 'five', 'five', 'five', 'setup']);
  k.coinState = { ...k.coinState, creator: TREASURY.publicKey };
  assert.equal((await sweep(k)).paid, 5, 'a fifth that came while the wrong key was given was never counted, or paid, once the right one was');
  assert.deepEqual([got(k, 455), new Set(k.chain.handedIn).size], [SOL(0.05), 1]);

  // (a tag from before the second cut-over is left as it was in this: after three days it is refused as too old)
  const old = world(1, RULES);
  old.coinState = { ...old.coinState, creator: null };
  const e = tag(old, 452);
  assert.equal((await handle(old, e)).state, 'waiting');
  old.coinState = { ...old.coinState, creator: TREASURY.publicKey };
  old.skip(3 * DAY + 3600_000);
  await sweep(old);
  assert.deepEqual([(await handle(old, e)).state, got(old, 452)], ['skipped', 0n]);
});

await test('five first sent after days of waiting, and not seen to arrive, are followed to the end: lost, they are sent again; arrived, the book is told', async () => {
  // lost on its way
  const w = world(0.02, FIVES);
  const five = (await cash(w, 453, 5)).map((x) => x.e);
  w.skip(5 * DAY);
  w.chain.balances.set(TREASURY.address, got(w, TREASURY.address) + SOL(1));
  w.chain.lose = true;
  assert.equal((await sweep(w)).paid, 0);
  assert.ok((await rowsOf(w, five)).every((r) => r.state === 'sending'));
  // half a minute on it could still turn up: nothing new is signed. Past its last block it is made again, for the same five.
  w.skip(30_000);
  await sweep(w);
  assert.deepEqual(five.map((e) => tries(w, e.id)), [1, 1, 1, 1, 1]);
  w.skip(100_000);
  w.chain.lose = false;
  assert.equal((await sweep(w)).paid, 5, 'a payment that was lost was never made again: its tags were more than four days old');
  assert.deepEqual([got(w, 453), (await readBook(w.store)).paid, got(w, TREASURY.address)], [SOL(0.05), 5, SOL(0.02) + SOL(1) - SOL(0.05) - 5n * RENT - FEE]);
  assert.deepEqual(five.map((e) => tries(w, e.id)), [2, 2, 2, 2, 2]);
  assert.equal(everyAttempt(w, five, 453), 2);
  w.skip(10 * 60_000);
  assert.equal((await sweep(w)).tried, 0);

  // arrived, but after the moment it was watched for: the book is told so at the next look, and nothing is sent again
  const v = world(0.02, FIVES);
  const slow = (await cash(v, 454, 5)).map((x) => x.e);
  v.skip(5 * DAY);
  v.chain.balances.set(TREASURY.address, got(v, TREASURY.address) + SOL(1));
  v.chain.landAfter = 100;
  assert.equal((await sweep(v)).paid, 0);
  v.skip(60_000);
  assert.equal(got(v, 454), SOL(0.05));
  assert.ok((await rowsOf(v, slow)).every((r) => r.state === 'sending'));
  assert.equal((await sweep(v)).paid, 5, 'a payment that had arrived was left as "sending" for good');
  assert.ok((await rowsOf(v, slow)).every((r, i) => r.state === 'paid' && r.receipt === receiptOf(slow[i].id)));
  assert.deepEqual([got(v, 454), new Set(v.chain.handedIn).size], [SOL(0.05), 1]);
});

await test('a traded tag is not paid though its first asking met trouble at the node; an honest one that met the same trouble is', async () => {
  const w = world(2, RULES);
  // Ann cashes Bob's tag: paid. Bob then cashes Ann's, and Cy cashes Dee's, at a moment when the node is not answering.
  assert.equal((await handle(w, tag(w, 460, { name: 'Ann', owner: 'Bob' }))).state, 'paid');
  const account = w.chain.account;
  w.chain.account = nodeDown;
  const back = tag(w, 461, { name: 'Bob', owner: 'Ann' }), honest = tag(w, 462, { name: 'Cy', owner: 'Dee' });
  for (const e of [back, honest]) {
    const o = await handle(w, e);
    assert.match(o.state === 'waiting' ? o.why : '', /could not be done just now/);
  }
  // the node answers again, and both are looked at again: the trade is told for what it is, and the other is paid
  w.chain.account = account;
  w.skip(60_000);
  await sweep(w);
  const o = await handle(w, back);
  assert.equal(o.state, 'skipped', 'the second of a trade was paid, because the node was not answering when it was first asked about');
  assert.match(o.state === 'skipped' ? o.why : '', /cashed each other's tags inside a day/);
  assert.equal(got(w, 461), 0n);
  assert.equal((await handle(w, honest)).state, 'paid');
  assert.ok(got(w, 462) > SOL(0.03));

  // Under the rule of five such a tag is not one of anybody's five either: Ann has four, Bob has cashed one of
  // hers, and her cashing of his, met by the same trouble, does not make five.
  const v = world(1, FIVES);
  await cash(v, 463, 4, { name: 'Ann', owner: 'Cy' });
  await cash(v, 464, 1, { name: 'Bob', owner: 'Ann' });
  v.skip(1000);
  const fifth = tag(v, 463, { name: 'Ann', owner: 'Bob' });
  const real = v.chain.account;
  v.chain.account = nodeDown;
  assert.equal((await handle(v, fifth)).state, 'waiting');
  v.chain.account = real;
  v.skip(60_000);
  await sweep(v);
  assert.deepEqual([(await handle(v, fifth)).state, got(v, 463), v.chain.handedIn.length, dueOf(await readBook(v.store), wallet(463)).length], ['skipped', 0n, 0, 4]);
  // (her next honest one is the fifth: five are paid, not six)
  assert.equal((await cash(v, 463, 1, { name: 'Ann', owner: 'Dee' }))[0].o.state, 'paid');
  assert.equal(got(v, 463), SOL(0.05));
});

await test('five whose payment was lost, and that the treasury can no longer pay, are not tried again until it can: a look that can do nothing asks, sends and writes nothing', async () => {
  const w = world(1, FIVES);
  const four = await cash(w, 470, 4);
  w.chain.lose = true;
  const [fifth] = await cash(w, 470, 1);
  w.chain.lose = false;
  assert.equal(fifth.o.state, 'sending');
  const five = [...four, fifth].map((x) => x.e);
  // the treasury is emptied meanwhile, and the payment can no longer arrive: the five wait for the treasury, and are
  // told so once (their attempt stays written on them: what is made again will be for the same five)
  w.chain.balances.set(TREASURY.address, SOL(0.02));
  w.skip(100_000);
  assert.equal((await sweep(w)).paid, 0);
  assert.ok((await rowsOf(w, five)).every((r) => r.state === 'waiting' && r.hold === 'funds' && r.tries?.length === 1 && r.lamports === 10_000_000));
  // An hour of looks, with a little coming in each time (enough to collect if it were asked for, and nothing like
  // enough to pay them), and the game server asking about them too: nothing is read, written, collected or sent
  const before = { ...w.store.ops, sent: w.chain.handedIn.length };
  for (let i = 0; i < 6; i++) {
    w.skip(10 * 60_000);
    w.chain.rewards = SOL(0.0002);
    assert.equal((await sweep(w)).tried, 0, 'five that the treasury cannot pay were tried again');
    assert.equal((await handle(w, five[i % 5])).state, 'waiting');
  }
  assert.deepEqual([w.store.ops.read, w.store.ops.swap, w.chain.handedIn.length, w.chain.rewards], [before.read, before.swap, before.sent, SOL(0.0002)]);
  // the money comes: made again for the same five, in one transaction, and paid once
  w.chain.rewards = 0n;
  w.chain.balances.set(TREASURY.address, got(w, TREASURY.address) + SOL(1));
  w.skip(10 * 60_000);
  assert.equal((await sweep(w)).paid, 5);
  assert.deepEqual([got(w, 470), (await readBook(w.store)).paid], [SOL(0.05), 5]);
  assert.deepEqual(five.map((e) => tries(w, e.id)), [2, 2, 2, 2, 2]);
  assert.equal(everyAttempt(w, five, 470), 2);
  // (two writes for it, as for any payment: the attempt, and the five paid)
  assert.equal(w.store.ops.swap, before.swap + 2);
});

await test('the rule of five put off after it has begun: what is owed under it is paid out as it stands, 0.01 a tag, a wallet at a time, and what comes after is paid as it was before', async () => {
  const ENV = { ...ON, ...FIVES };
  const w = world(100.01, FIVES);
  const three = (await cash(w, 480, 3)).map((x) => x.e), one = (await cash(w, 481, 1)).map((x) => x.e);
  // (they have waited forty days, as they may)
  w.skip(40 * DAY);
  assert.equal((await sweep(w)).tried, 0);
  // the moment is taken away again, and nothing else is touched: the next look pays each wallet what it has due
  w.cfg = config({ ...ENV, PAYOUT_RULES2_FROM: 'never' });
  assert.equal(w.cfg.rules2From, Infinity);
  const r = await sweep(w);
  assert.deepEqual([r.tried, r.paid], [2, 4], 'with the rule put off, the tags taken in under it were left waiting for a fifth');
  // at what they were promised, though the treasury is full (two per cent of it is 2 SOL): one transaction a wallet,
  // with a receipt for each tag, as a five is paid
  assert.deepEqual([got(w, 480), got(w, 481), new Set(w.chain.handedIn).size], [SOL(0.03), SOL(0.01), 2]);
  const tx = parse(unwire(attempts(w, three[0].id)[0].wire));
  assert.deepEqual([tx.creates.map((c) => b58(c.at)), tx.transfers.map((t) => t.lamports)], [three.map((e) => receiptOf(e.id)), [SOL(0.03)]]);
  assert.ok((await rowsOf(w, [...three, ...one])).every((x) => x.state === 'paid' && x.lamports === 10_000_000 && x.rules === 2));
  // what is cashed in from then on is paid as it was before the moment: by itself, at its share of the treasury
  const [next] = await cash(w, 480, 1);
  assert.equal(next.o.state, 'paid');
  assert.ok(got(w, 480) > SOL(0.03) + SOL(1.9));
  assert.equal((await rowsOf(w, [next.e]))[0].rules, undefined);
  w.skip(10 * 60_000);
  assert.equal((await sweep(w)).tried, 0);

  // Until that look, the page says what is so: one line a wallet still, "3 due" and what it is paid, not "3 of 5";
  // and whoever looks at it sets the paying off. The game server, asking about one of them, has it seen to.
  const p = world(100.01, FIVES);
  const waits = (await cash(p, 482, 3)).map((x) => x.e);
  const page = async () => (await show(new Request('https://site.test/payouts'), p)).text();
  let html = await page();
  assert.ok(html.includes('>3 of 5</em>') && !html.includes("fetch('/api/tick')"));
  p.cfg = config({ ...ENV, PAYOUT_RULES2_FROM: 'never' });
  html = await page();
  for (const want of ['>3 due</em>', '0.03 SOL</b> <i>for 3 tags: being paid</i>', 'owed to 1 wallet that is being paid now', "fetch('/api/tick')"]) assert.ok(html.includes(want), `with the rule put off, the page does not say "${want}"`);
  assert.ok(!html.includes('of 5</em>') && !html.includes('are due'));
  assert.equal(html.split('data-s="open"').length - 1, 1);
  assert.deepEqual([(await handle(p, waits[1])).state, got(p, 482), new Set(p.chain.handedIn).size], ['paid', SOL(0.03), 1]);

  // The moment moved on to one that has not come yet is the rule put off, the same.
  const m = world(1, FIVES);
  await cash(m, 484, 2);
  m.cfg = config({ ...ENV, PAYOUT_RULES2_FROM: '2027-06-01T00:00:00Z' });
  assert.deepEqual([(await sweep(m)).paid, got(m, 484)], [2, SOL(0.02)]);

  // And the other way there was before this one, with the rule left on: the count set to one. What waits is paid
  // at the next look, the same way; and each tag after it as it comes, flat.
  const v = world(100.01, FIVES);
  await cash(v, 485, 3);
  await cash(v, 486, 1);
  v.cfg = config({ ...ENV, PAYOUT_MIN_TAGS: '1' });
  assert.deepEqual([(await sweep(v)).paid, got(v, 485), got(v, 486), new Set(v.chain.handedIn).size], [4, SOL(0.03), SOL(0.01), 2]);
  assert.equal((await cash(v, 485, 1))[0].o.state, 'paid');
  assert.equal(got(v, 485), SOL(0.04));
});

await test('five and more of one wallet over weeks, with payouts not set up now and then, the treasury empty now and then, payments lost and late: none is left behind for its age, none is paid twice, and with the rule put off every one is paid', async () => {
  for (let round = 0; round < Number(process.env.ROUNDS ?? 150) / 3; round++) {
    const ENV = { ...FIVES, PAYOUT_DAY_CAP_PERCENT: '100' };
    const w = world(1, ENV);
    const to = 3000 + round;
    const count = 5 + Math.floor(Math.random() * 8);
    const es: Entry[] = [];
    const receipts = () => es.filter((e) => got(w, receiptOf(e.id)) > 0n).length;
    const whole = () => assert.equal(got(w, to), BigInt(receipts()) * SOL(0.01), 'the wallet does not hold exactly 0.01 for each receipt');
    for (let step = 0; step < 24; step++) {
      w.chain.lose = Math.random() < 0.3;
      w.chain.landAfter = 1 + Math.floor(Math.random() * 120);
      w.chain.forgets = Math.random() < 0.2 ? Math.random() : 0;
      // the chain cannot say who made the coin, for a while; the treasury is emptied, or filled again
      w.coinState = { ...w.coinState, creator: Math.random() < 0.25 ? null : TREASURY.publicKey };
      if (Math.random() < 0.3) w.chain.balances.set(TREASURY.address, Math.random() < 0.5 ? SOL(0.015) : SOL(1));
      // a new tag or two while there are any to come, questions about the old ones, and the housekeeping: all at once
      const calls: Promise<unknown>[] = [];
      for (let k = 0; k < 2 && es.length < count; k++) {
        if (Math.random() < 0.4) continue;
        es.push(tag(w, to));
        calls.push(handle(w, es[es.length - 1]).catch(() => null));
      }
      for (const e of es) if (Math.random() < 0.2) calls.push(handle(w, e).catch(() => null));
      if (Math.random() < 0.5) calls.push(sweep(w).catch(() => null));
      await Promise.all(calls);
      // The housekeeping looks every ten minutes, and what has gone wrong may last for days: so one look by itself,
      // with things as they are, and then as much as five days in which nobody looks at all.
      w.skip(Math.random() < 0.5 ? 3000 : 95_000);
      await sweep(w);
      w.skip([0, 95_000, DAY, 5 * DAY][Math.floor(Math.random() * 4)]);
      whole();
    }
    // All is well from here on, and the game server asks about every one of them as it would. In half of the
    // rounds the rule is put off as well (the way back): then nothing is left waiting to be five.
    Object.assign(w.chain, { lose: false, landAfter: 2, forgets: 0 });
    w.coinState = { ...w.coinState, creator: TREASURY.publicKey };
    w.chain.balances.set(TREASURY.address, SOL(1));
    const off = round % 2 === 1;
    if (off) w.cfg = config({ ...ON, ...ENV, PAYOUT_RULES2_FROM: 'never' });
    while (es.length < count) es.push(tag(w, to));
    for (let i = 0; i < 8; i++) {
      for (const e of es) await handle(w, e);
      await sweep(w);
      w.skip(i ? 95_000 : DAY);
      whole();
    }
    const rows = await rowsOf(w, es);
    const book = await readBook(w.store);
    const paid = rows.filter((r) => r?.state === 'paid').length;
    assert.deepEqual([got(w, to), receipts(), book.paid, book.paidLamports], [BigInt(paid) * SOL(0.01), paid, paid, paid * 10_000_000]);
    // each is paid; or its five attempts were used up; or, with the rule on, it is one of fewer than five that wait for the rest
    rows.forEach((r, i) => assert.ok(r && (r.state === 'paid' || (r.state === 'waiting' && ((r.hold === 'five' && !off) || (r.hold === 'hand' && tries(w, es[i].id) === 5)))), `left ${r?.state} ${r?.hold ?? ''}: ${r?.why ?? ''} (cashed in ${r?.at})`));
    assert.ok(rows.filter((r) => r.state === 'waiting' && r.hold === 'five').length < 5, 'five were due and were not paid');
    everyAttempt(w, es, to);
  }
});

console.log(`${n} checks passed`);
