// The payout system against a real cluster: Solana's devnet, the test network whose SOL is
// handed out free and is worth nothing. A wallet is made up on the spot, given test SOL by
// the faucet, and used as the treasury: real signatures, real transactions, real waiting.
// Not part of the ordinary checks (the faucet turns people away when it is busy):
//
//   npx tsx test/devnet.test.ts

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Keypair, LAMPORTS, Rpc, address, b58 } from '../api/_lib/solana';
import { MemoryStore } from '../api/_lib/store';
import { config, handle, readBook, type Entry, type World } from '../api/_lib/payouts';

const URL = process.env.DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';
const rpc = new Rpc(URL, 20000);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const freshSecret = () => b58(Uint8Array.from(randomBytes(32)));
/** a wallet nobody has used: a real address, with a key that is thrown away */
const fresh = () => new Keypair(freshSecret()).address;

const secret = freshSecret();
const treasury = new Keypair(secret);
console.log('a treasury made up for this run:', treasury.address);

let funded = false;
for (let i = 0; i < 4 && !funded; i++) {
  try {
    await rpc.call('requestAirdrop', [treasury.address, 0.5 * LAMPORTS]);
    for (let k = 0; k < 30 && !funded; k++) {
      await sleep(1500);
      funded = (await rpc.balance(treasury.publicKey)) > 0n;
    }
  } catch (e) {
    console.log('  the faucet said:', (e as Error).message);
    await sleep(4000);
  }
}
if (!funded) {
  console.log('no test SOL to be had just now: nothing was checked');
  process.exit(2);
}
console.log('  given', Number(await rpc.balance(treasury.publicKey)) / LAMPORTS, 'test SOL');

const store = new MemoryStore();
const w: World = {
  cfg: config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: secret, SOLANA_RPC_URL: URL, TAG_PAY_MIN_SOL: '0.01' }),
  rpc,
  store,
  now: Date.now,
  sleep,
  random: Math.random,
  // (the coin does not exist on the test network: there is nothing to collect there)
  coin: async () => ({ unsupported: 'not on this network', creator: null, graduated: false, curve: 0n, pool: 0n, poolAccount: null, poolQuote: null }),
};
const tag = (to: string): Entry => ({ id: `dev${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, at: new Date().toISOString(), name: 'Tester', owner: 'Victim', wallet: to });

// one tag, to a wallet that has never existed
const one = fresh();
const e1 = tag(one);
const t0 = Date.now();
const o1 = await handle(w, e1);
console.log(`  first tag: ${o1.state} after ${((Date.now() - t0) / 1000).toFixed(1)} s`, o1.state === 'paid' ? o1.signature : JSON.stringify(o1));
assert.equal(o1.state, 'paid');
assert.equal(await rpc.balance(address(one)), 10_000_000n);
// asked again: nothing more is sent
assert.equal((await handle(w, e1)).state, 'paid');
await sleep(3000);
assert.equal(await rpc.balance(address(one)), 10_000_000n);

// the same tag reported three times at once
const two = fresh();
const e2 = tag(two);
const all = await Promise.all([handle(w, e2), handle(w, e2), handle(w, e2)]);
console.log('  three at once:', all.map((o) => o.state).join(', '));
for (let i = 0; i < 20 && (await handle(w, e2)).state !== 'paid'; i++) await sleep(2000);
await sleep(4000);
assert.equal(await rpc.balance(address(two)), 10_000_000n);
assert.equal([...store.files.keys()].filter((k) => k.startsWith(`ledger/try/${e2.id}/`)).length, 1);

const book = await readBook(store);
assert.deepEqual([book.paid, book.paidLamports], [2, 20_000_000]);
const spent = 500_000_000n - (await rpc.balance(treasury.publicKey));
console.log(`  the treasury is down ${Number(spent) / LAMPORTS} test SOL: two tags of 0.01 and two fees`);
assert.ok(spent >= 20_010_000n && spent < 20_020_000n);
console.log('devnet: paid, once each');
