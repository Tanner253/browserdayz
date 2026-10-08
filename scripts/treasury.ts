// A look at the treasury from outside, with no key: who the coin's creator is, what the
// wallet holds, what creator rewards are waiting, and whether the transaction that would
// collect them would go through if it were sent now. Nothing is signed and nothing moves.
//
//   npx tsx scripts/treasury.ts [mint] [rpc url]

import { Rpc, address, b58, closeTokenAccount, computeLimit, computePrice, memo, receipt, seeded, tokenAccount, transfer, unsigned, LAMPORTS, WRAPPED_SOL } from '../api/_lib/solana';
import { claimCurve, claimPool, state } from '../api/_lib/pump';
import { config, price } from '../api/_lib/payouts';

const MINT = process.argv[2] ?? 'GvfAzdPF466PJsPJMzXQeX3TSqmJm9YxAG8xBJ6ypump';
const rpc = new Rpc(process.argv[3] ?? process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com', 20000);
const sol = (l: bigint) => (Number(l) / LAMPORTS).toFixed(6) + ' SOL';

const mint = address(MINT);
const s = await state(rpc, mint);
console.log('coin', MINT);
if (!s.creator) {
  console.log(' ', s.unsupported);
  process.exit(0);
}
const creator = s.creator;
const balance = await rpc.balance(creator);
console.log('creator (the treasury):', b58(creator));
console.log('  holds', sol(balance));
console.log('  graduated to PumpSwap:', s.graduated ? 'yes' : 'no');
if (s.unsupported) console.log('  nothing to collect here:', s.unsupported);
console.log('  rewards waiting on the bonding curve side:', sol(s.curve));
console.log('  rewards waiting on the PumpSwap side:', s.poolAccount ? sol(s.pool) : 'no pool');

const hash = (await rpc.latestBlockhash()).blockhash;
const tryIt = async (name: string, ixs: ReturnType<typeof claimCurve>) => {
  const sim = await rpc.simulate(unsigned(creator, [computeLimit(400_000), ...ixs], hash), [creator]);
  const after = sim.lamports[0];
  console.log(`  a claim of the ${name} side, tried without sending: ${sim.err ? 'WOULD FAIL ' + JSON.stringify(sim.err) : 'would go through'}, ${sim.units} units of work` + (after !== null && !sim.err ? `, wallet ${after >= balance ? '+' : '-'}${sol(after >= balance ? after - balance : balance - after)} (fee not counted)` : ''));
  if (sim.err) for (const l of sim.logs.slice(-8)) console.log('      ' + l);
};
if (!s.unsupported) {
  // (sent by a wallet that is not the creator's, as the site does it: here, any wallet with money in it)
  const other = address(process.argv[4] ?? 'HZ8C8hoSpCVJdHLSXVRQiDiNQnfXNxrbHNy43GvyAUtt');
  const sim = await rpc.simulate(unsigned(other, [computeLimit(400_000), ...claimCurve(other, mint, creator)], hash), [creator]);
  console.log(`  the same claim sent by another wallet (${b58(other).slice(0, 4)}…): ${sim.err ? 'WOULD FAIL ' + JSON.stringify(sim.err) : 'would go through'}, the creator ${sim.lamports[0] != null ? '+' + sol(sim.lamports[0] - balance) : '?'}`);
  await tryIt('curve', claimCurve(creator, mint, creator));
  if (s.poolAccount && s.poolQuote) {
    await tryIt('pool (then unwrapped)', [...claimPool(creator, creator, s.poolAccount, s.poolQuote), closeTokenAccount(tokenAccount(creator, WRAPPED_SOL), creator, creator)]);
    const p = await rpc.simulate(unsigned(other, [computeLimit(400_000), ...claimPool(other, creator, s.poolAccount, s.poolQuote)], hash));
    console.log(`  the pool claim sent by another wallet: ${p.err ? 'WOULD FAIL ' + JSON.stringify(p.err) : 'would go through'}, ${p.units} units of work`);
    if (p.err) for (const l of p.logs.slice(-6)) console.log('      ' + l);
  }
}

// and a payout: what a tag would pay now, tried (not sent) to a wallet that exists and to one that does not yet
const cfg = config({});
const pays = price(balance, cfg);
console.log(`a tag cashed in now would pay ${sol(pays)} (${cfg.share * 100}% of the treasury, ${sol(cfg.floor)} at least)`);
for (const [what, to] of [['a wallet in use', 'C8C2LwicsKUzaJse5gN9hnMRinDV5rNy2EmGqFyA8NaY'], ['a wallet never used', b58(Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255))]] as const) {
  const todo = [computeLimit(40_000), computePrice(cfg.bid), receipt(creator, 'test00000000000000000000'), transfer(creator, address(to), pays), memo('ZONA dog tag test00000000000000000000')];
  void seeded;
  const sim = await rpc.simulate(unsigned(creator, todo, hash), [creator, address(to)]);
  console.log(`  to ${what}, tried without sending: ${sim.err ? 'WOULD FAIL ' + JSON.stringify(sim.err) : 'would go through'}, ${sim.units} units of work, treasury ${sim.lamports[0] !== null ? '-' + sol(balance - sim.lamports[0]) : '?'}, they would hold ${sim.lamports[1] != null ? sol(sim.lamports[1]) : '?'}`);
  if (sim.err) for (const l of sim.logs.slice(-6)) console.log('      ' + l);
}
