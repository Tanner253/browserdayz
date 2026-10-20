// The book's tally of SOL paid by wallet (api/_lib/payouts.ts `earned`): begun from the payments the rows had lost, read off
// the chain (api/_lib/paid-before.ts), and the rows kept, a payment in both counted once; and added to with every payment.
import assert from 'node:assert/strict';
import { earnedOf, enter, type Book } from '../api/_lib/payouts';
import { PAID_BEFORE } from '../api/_lib/paid-before';

const chain: Record<string, number> = {};
for (const [, wallet, lamports] of PAID_BEFORE) chain[wallet] = (chain[wallet] ?? 0) + lamports;
const [sig0, wallet0, lamports0] = PAID_BEFORE[0];
const book: Book = {
  v: 1, since: '2026-10-08T00:00:00Z', seeded: true, tags: 2, paid: 2, paidLamports: 0, claims: [], claimedLamports: 0, claimNote: '',
  rows: [
    // (one the chain has too, by its transaction: counted once)
    { ref: 'a', at: '2026-10-14T22:44:00Z', name: 'A', owner: 'B', wallet: wallet0, state: 'paid', lamports: lamports0, signature: sig0 },
    { ref: 'b', at: '2026-10-15T10:00:00Z', name: 'C', owner: 'D', wallet: 'NewWallet111', state: 'paid', lamports: 20_000_000, signature: 'sigB' },
  ],
} as unknown as Book;

const before = earnedOf(book);
assert.equal(before[wallet0].lamports, chain[wallet0], 'a payment both on the chain and in the rows was counted twice');
assert.deepEqual(before.NewWallet111, { lamports: 20_000_000, n: 1 });
assert.equal(Object.values(before).reduce((n, e) => n + e.lamports, 0), Object.values(chain).reduce((n, v) => n + v, 0) + 20_000_000);
console.log('  ok  begun from the chain and the rows, a payment in both counted once');

// a tag paid now: the tally is begun before it, and it is added once
enter(book, { ref: 'c', at: '2026-10-19T10:00:00Z', name: 'E', owner: 'F', wallet: 'NewWallet111' }, { state: 'paid', lamports: 15_000_000, at: '2026-10-19T10:01:00Z', signature: 'sigC', receipt: '' } as never, '2026-10-19');
assert.deepEqual(book.earned?.NewWallet111, { lamports: 35_000_000, n: 2 }, 'a payment was not added to the tally, or added twice');
assert.equal(earnedOf(book), book.earned, 'the page does not read the book’s own tally once it has one');
console.log('  ok  each payment is added to the tally, once');
console.log('\n2 checks passed');
