// Creator rewards on pump.fun: where a coin's creator fees pile up, and the transactions that
// bring them home to the creator's wallet.
//
// Written from pump.fun's own published interface (github.com/pump-fun/pump-public-docs:
// idl/pump.json, idl/pump_amm.json, docs/instructions/COLLECT_CREATOR_FEE.md and
// SWEEP_FEES.md, as they stood on 8 October 2026). Two places hold a creator's fees:
//
//   on the bonding curve   fees from trades wait on the curve itself until they are swept
//                          into the creator's vault (sweep_creator_fee), from which
//                          collect_creator_fee_v2 pays the creator in plain SOL
//   on PumpSwap            once the coin has graduated: the same, pool -> vault
//                          (sweep_creator_fee), then collect_coin_creator_fee pays wrapped
//                          SOL into the creator's token account, which is then closed to
//                          turn it into plain SOL
//
// Anybody may send these: the money can only go to the creator. They apply to a coin with
// one creator, paired with SOL, which is what a coin made in the ordinary way is. A coin
// whose fees are shared out (a "sharing config") or go to holders is paid by pump.fun's own
// machinery and there is nothing here to collect: `state()` says so.
//
// pump.fun changes its programs often. Nothing below is sent without being tried first
// (see claim() in payouts.ts): if an account list here has gone stale the try fails, no
// fee is paid, the page says the claim failed, and payouts carry on from what the treasury
// already holds.

import { ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, WRAPPED_SOL, address, closeTokenAccount, openTokenAccount, programAddress, readU64, same, tokenAccount, type Bytes, type Instruction, type Rpc } from './solana.js';

/** the two questions asked of the chain here */
export type Reader = Pick<Rpc, 'account' | 'tokenBalance'>;

export const PUMP = address('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_AMM = address('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// the first eight bytes of an account or an instruction say which kind it is
const CURVE_KIND = [23, 183, 248, 55, 96, 216, 172, 96];
const POOL_KIND = [241, 154, 109, 4, 17, 177, 109, 188];
const SWEEP_CREATOR_FEE = Uint8Array.of(32, 246, 191, 52, 8, 201, 73, 186);
const COLLECT_CREATOR_FEE_V2 = Uint8Array.of(207, 17, 138, 242, 4, 34, 19, 56);
const COLLECT_COIN_CREATOR_FEE = Uint8Array.of(160, 57, 89, 42, 181, 139, 43, 66);

/** what an account with nothing in it must hold to be left alone by the chain: the vault keeps this much back */
const EMPTY_ACCOUNT_RENT = 890_880n;

const isKind = (data: Bytes, kind: number[]) => data.length >= 8 && kind.every((v, i) => data[i] === v);
const u16le = (n: number) => Uint8Array.of(n & 255, n >> 8);

export interface CoinState {
  /** why there is nothing here to collect, when there is not */
  unsupported: string | null;
  creator: Bytes | null;
  /** the coin has left its bonding curve for PumpSwap */
  graduated: boolean;
  /** lamports that a claim would bring in now: from the curve side, and from the pool side */
  curve: bigint;
  pool: bigint;
  /** the PumpSwap pool and where it keeps its SOL, if there is one */
  poolAccount: Bytes | null;
  poolQuote: Bytes | null;
}

/** Reads where a coin's creator fees stand. */
export async function state(rpc: Reader, mint: Bytes): Promise<CoinState> {
  const none: CoinState = { unsupported: null, creator: null, graduated: false, curve: 0n, pool: 0n, poolAccount: null, poolQuote: null };
  const curveAt = programAddress(['bonding-curve', mint], PUMP);
  const curve = await rpc.account(curveAt);
  if (!curve || !same(curve.owner, PUMP) || !isKind(curve.data, CURVE_KIND) || curve.data.length < 81) return { ...none, unsupported: 'not a pump.fun coin' };
  const d = curve.data;
  const creator = d.subarray(49, 81);
  const graduated = d[48] === 1;
  // (an account written before a field existed is shorter: what is missing reads as nothing)
  const quote = d.length >= 115 ? d.subarray(83, 115) : new Uint8Array(32);
  if (!same(quote, WRAPPED_SOL) && !same(quote, new Uint8Array(32))) return { ...none, creator, graduated, unsupported: 'the coin is not paired with SOL' };
  if (d.length >= 125 && d[124] === 1) return { ...none, creator, graduated, unsupported: 'the coin pays its creator fees to holders' };
  // a creator that is itself a program's account is a sharing config: pump.fun pays those out
  const who = await rpc.account(creator);
  if (who && !same(who.owner, SYSTEM_PROGRAM)) return { ...none, creator, graduated, unsupported: 'the coin shares its creator fees between several wallets' };

  const waiting = d.length >= 133 ? readU64(d, 125) : 0n;
  const vault = await rpc.account(programAddress(['creator-vault', creator], PUMP));
  const inVault = vault && vault.lamports > EMPTY_ACCOUNT_RENT ? vault.lamports - EMPTY_ACCOUNT_RENT : 0n;
  const out: CoinState = { ...none, creator, graduated, curve: waiting + inVault };

  const poolAt = programAddress(['pool', u16le(0), programAddress(['pool-authority', mint], PUMP), mint, WRAPPED_SOL], PUMP_AMM);
  const pool = await rpc.account(poolAt);
  if (pool && same(pool.owner, PUMP_AMM) && isKind(pool.data, POOL_KIND) && pool.data.length >= 243) {
    const p = pool.data;
    const coinCreator = p.subarray(211, 243);
    // (the pool pays whoever it has down as the coin's creator: only collected when that is the same wallet)
    if (same(coinCreator, creator)) {
      const waitingInPool = p.length >= 287 ? readU64(p, 279) : 0n;
      const held = await rpc.tokenBalance(tokenAccount(programAddress(['creator_vault', creator], PUMP_AMM), WRAPPED_SOL));
      out.pool = waitingInPool + held;
      out.poolAccount = poolAt;
      out.poolQuote = p.subarray(171, 203);
    }
  }
  return out;
}

/** Curve side: sweep what is waiting into the vault, then the vault to the creator, as SOL. */
export function claimCurve(payer: Bytes, mint: Bytes, creator: Bytes): Instruction[] {
  const curve = programAddress(['bonding-curve', mint], PUMP);
  const vault = programAddress(['creator-vault', creator], PUMP);
  const events = programAddress(['__event_authority'], PUMP);
  return [
    {
      program: PUMP,
      data: SWEEP_CREATOR_FEE,
      keys: [
        { pubkey: payer, signer: true, writable: true },
        { pubkey: programAddress(['global'], PUMP) },
        { pubkey: mint },
        { pubkey: WRAPPED_SOL },
        { pubkey: TOKEN_PROGRAM },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM },
        { pubkey: SYSTEM_PROGRAM },
        { pubkey: curve, writable: true },
        { pubkey: tokenAccount(curve, WRAPPED_SOL), writable: true },
        { pubkey: vault, writable: true },
        { pubkey: tokenAccount(vault, WRAPPED_SOL), writable: true },
        { pubkey: events },
        { pubkey: PUMP },
      ],
    },
    {
      program: PUMP,
      data: COLLECT_CREATOR_FEE_V2,
      keys: [
        { pubkey: creator, writable: true },
        { pubkey: tokenAccount(creator, WRAPPED_SOL), writable: true },
        { pubkey: vault, writable: true },
        { pubkey: tokenAccount(vault, WRAPPED_SOL), writable: true },
        { pubkey: WRAPPED_SOL },
        { pubkey: TOKEN_PROGRAM },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM },
        { pubkey: SYSTEM_PROGRAM },
        { pubkey: events },
        { pubkey: PUMP },
      ],
    },
  ];
}

/**
 * Pool side: sweep what is waiting into the vault, the vault to the creator's wrapped-SOL
 * account (opened first if there is none), and that account closed, which hands its
 * contents over as plain SOL. The creator signs: only the owner may close their account.
 */
export function claimPool(creator: Bytes, pool: Bytes, poolQuote: Bytes): Instruction[] {
  const authority = programAddress(['creator_vault', creator], PUMP_AMM);
  const events = programAddress(['__event_authority'], PUMP_AMM);
  const mine = tokenAccount(creator, WRAPPED_SOL);
  return [
    {
      program: PUMP_AMM,
      data: SWEEP_CREATOR_FEE,
      keys: [
        { pubkey: creator, signer: true, writable: true },
        { pubkey: programAddress(['global_config'], PUMP_AMM) },
        { pubkey: pool, writable: true },
        { pubkey: WRAPPED_SOL },
        { pubkey: TOKEN_PROGRAM },
        { pubkey: poolQuote, writable: true },
        { pubkey: authority },
        { pubkey: tokenAccount(authority, WRAPPED_SOL), writable: true },
        { pubkey: SYSTEM_PROGRAM },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM },
        { pubkey: events },
        { pubkey: PUMP_AMM },
      ],
    },
    openTokenAccount(creator, creator, WRAPPED_SOL),
    {
      program: PUMP_AMM,
      data: COLLECT_COIN_CREATOR_FEE,
      keys: [
        { pubkey: WRAPPED_SOL },
        { pubkey: TOKEN_PROGRAM },
        { pubkey: creator },
        { pubkey: authority },
        { pubkey: tokenAccount(authority, WRAPPED_SOL), writable: true },
        { pubkey: mine, writable: true },
        { pubkey: events },
        { pubkey: PUMP_AMM },
      ],
    },
    closeTokenAccount(mine, creator, creator),
  ];
}
