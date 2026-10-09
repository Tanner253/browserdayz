// The payout system against a chain made up for the purpose (test/fake.ts): one that loses
// transactions, takes its time, refuses, forgets, and is asked the same thing twice at once.
// No network, no real key, no money. `npx tsx test/payouts.test.ts`

import assert from 'node:assert/strict';
import { address, b58, seeded } from '../api/_lib/solana';
import { claimIfDue, config, handle, price, readBook, refOf, snapshot, sweep, type Book, type Entry } from '../api/_lib/payouts';
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
  // two per cent of what can be spent, and never less than 0.02
  assert.equal(price(SOL(0.44), c), SOL(0.02));
  assert.equal(price(SOL(1.01), c), SOL(0.02));
  assert.equal(price(SOL(10.01), c), SOL(0.2));
  assert.equal(price(SOL(100.01), c), SOL(2));
  assert.equal(price(SOL(1000), c), SOL(5));
  assert.equal(price(0n, c), SOL(0.02));
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

await test('no more than half the treasury in a day', async () => {
  const w = world(0.21);
  const states: string[] = [];
  const held: Entry[] = [];
  for (let i = 0; i < 8; i++) {
    const e = tag(w, 20 + i);
    const o = await handle(w, e);
    states.push(o.state);
    if (o.state === 'waiting') held.push(e);
  }
  assert.deepEqual(states, ['paid', 'paid', 'paid', 'paid', 'paid', 'waiting', 'waiting', 'waiting']);
  assert.ok(got(w, TREASURY.address) > SOL(0.099));
  // the day after, the ones that waited are paid until that day's half is gone too
  w.skip(13 * 3600 * 1000);
  const r = await sweep(w);
  assert.equal(r.paid, 2);
  assert.deepEqual([25, 26, 27].map((i) => got(w, i)).sort(), [0n, SOL(0.02), SOL(0.02)]);
  assert.equal(held.length, 3);
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
  // to thirty wallets: no more than half of what the treasury began the day with
  const many = world(0.5);
  const each = Array.from({ length: 30 }, (_, i) => tag(many, 600 + i));
  await Promise.all(each.map((e) => handle(many, e)));
  many.skip(5000);
  for (const e of each) await handle(many, e);
  const paid = (await readBook(many.store)).rows.filter((r) => r.state === 'paid');
  assert.ok(paid.length >= 10 && paid.length <= 12, `${paid.length} paid`);
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

console.log(`${n} checks passed`);
