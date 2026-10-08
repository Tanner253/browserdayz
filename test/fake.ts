// A chain made up for the tests: one that reads the very bytes the real one would be sent,
// checks the signature, moves balances only for a transaction it can parse, and can be told
// to lose transactions, take its time, refuse, or fail them. And a world built round it.

import assert from 'node:assert/strict';
import { Keypair, LAMPORTS, SYSTEM_PROGRAM, address, b58, same, verify, type Bytes, type Signed, type Status } from '../api/_lib/solana';
import { PUMP, type CoinState } from '../api/_lib/pump';
import { MemoryStore } from '../api/_lib/store';
import { config, type Entry, type World } from '../api/_lib/payouts';

export const SOL = (n: number) => BigInt(Math.round(n * LAMPORTS));
const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));

// ------------------------------------------------------------------ a chain

export interface Parsed {
  payer: Bytes;
  blockhash: string;
  transfers: { from: Bytes; to: Bytes; lamports: bigint }[];
  memos: string[];
  collects: boolean;
}

/** Reads a transaction the way a validator does, and refuses one that is not well formed or not signed by its payer. */
export function parse(wire: Bytes, checkSignature = true): Parsed {
  let at = 0;
  const short = () => {
    let n = 0;
    for (let shift = 0; ; shift += 7) {
      const b = wire[at++];
      n |= (b & 127) << shift;
      if (!(b & 128)) return n;
    }
  };
  const sigs = short();
  assert.equal(sigs, 1);
  const sig = wire.subarray(at, (at += 64));
  const msg = wire.subarray(at);
  const [signers] = [wire[at], wire[at + 1], wire[at + 2]];
  at += 3;
  assert.equal(signers, 1);
  const keys: Bytes[] = [];
  for (let n = short(); n > 0; n--) keys.push(wire.subarray(at, (at += 32)));
  const blockhash = b58(wire.subarray(at, (at += 32)));
  if (checkSignature) assert.ok(verify(msg, sig, keys[0]), 'the payer did not sign this');
  const out: Parsed = { payer: keys[0], blockhash, transfers: [], memos: [], collects: false };
  for (let n = short(); n > 0; n--) {
    const program = keys[wire[at++]];
    const accounts: number[] = [];
    for (let k = short(); k > 0; k--) accounts.push(wire[at++]);
    const len = short();
    const data = wire.subarray(at, (at += len));
    if (same(program, SYSTEM_PROGRAM) && data[0] === 2 && data.length === 12) {
      let v = 0n;
      for (let i = 11; i >= 4; i--) v = (v << 8n) | BigInt(data[i]);
      assert.equal(accounts[0], 0, 'only the signer can be the one who pays');
      out.transfers.push({ from: keys[accounts[0]], to: keys[accounts[1]], lamports: v });
    } else if (b58(program) === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') out.memos.push(new TextDecoder().decode(data));
    else if (same(program, PUMP) && data[0] === 207) out.collects = true;
  }
  assert.equal(at, wire.length, 'bytes left over');
  return out;
}

export class FakeChain {
  height = 10_000;
  balances = new Map<string, bigint>();
  /** addresses that belong to a program, not to a person */
  programOwned = new Set<string>();
  private hashes = new Map<string, number>();
  private landedAt = new Map<string, { height: number; err: unknown }>();
  private flying: { sig: string; tx: Parsed; due: number; lastValid: number }[] = [];
  /** every transaction handed in, in order (the same one twice is two entries) */
  handedIn: string[] = [];
  /** how it behaves */
  lose = false;
  refuse = false;
  landAfter = 2;
  failNext = false;
  /** creator rewards waiting to be collected */
  rewards = 0n;
  statusCalls = 0;

  private bal = (k: Bytes) => this.balances.get(b58(k)) ?? 0n;

  /** the chain moves on by this many blocks */
  tick(blocks = 1) {
    for (; blocks > 0; blocks--) {
      this.height++;
      for (const f of this.flying.filter((x) => x.due <= this.height)) {
        this.flying.splice(this.flying.indexOf(f), 1);
        if (this.height > f.lastValid || this.landedAt.has(f.sig)) continue;
        const need = f.tx.transfers.reduce((s, t) => s + t.lamports, 0n) + 5000n;
        let err: unknown = null;
        if (this.failNext || this.bal(f.tx.payer) < need) err = { InstructionError: [2, { Custom: 1 }] };
        this.failNext = false;
        this.balances.set(b58(f.tx.payer), this.bal(f.tx.payer) - 5000n);
        if (!err) {
          for (const t of f.tx.transfers) {
            this.balances.set(b58(t.from), this.bal(t.from) - t.lamports);
            this.balances.set(b58(t.to), this.bal(t.to) + t.lamports);
          }
          if (f.tx.collects) {
            this.balances.set(b58(f.tx.payer), this.bal(f.tx.payer) + this.rewards);
            this.rewards = 0n;
          }
        }
        this.landedAt.set(f.sig, { height: this.height, err });
      }
    }
  }

  async balance(who: Bytes) {
    return this.bal(who);
  }
  async latestBlockhash() {
    const blockhash = b58(Uint8Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)));
    this.hashes.set(blockhash, this.height + 150);
    return { blockhash, lastValidBlockHeight: this.height + 150 };
  }
  async blockHeight() {
    return this.height - 32;
  }
  async send(tx: Signed) {
    this.handedIn.push(tx.signature);
    if (this.refuse) throw new Error('the node would not take it');
    const p = parse(tx.wire);
    const lastValid = this.hashes.get(p.blockhash);
    if (lastValid === undefined || this.height > lastValid) throw new Error('Blockhash not found');
    if (this.lose || this.landedAt.has(tx.signature) || this.flying.some((f) => f.sig === tx.signature)) return;
    this.flying.push({ sig: tx.signature, tx: p, due: this.height + this.landAfter, lastValid });
  }
  async statuses(sigs: string[]): Promise<(Status | null)[]> {
    this.statusCalls++;
    return sigs.map((s) => {
      const l = this.landedAt.get(s);
      return l ? { slot: l.height, err: l.err, confirmationStatus: this.height - l.height >= 32 ? 'finalized' : 'confirmed' } : null;
    });
  }
  simFails = false;
  async simulate(wire: Bytes, watch: Bytes[] = []) {
    const p = parse(wire, false);
    const out = new Map(this.balances);
    const need = p.transfers.reduce((s, t) => s + t.lamports, 0n) + 5000n;
    const err = this.simFails || (out.get(b58(p.payer)) ?? 0n) < need ? { InstructionError: [1, 'Custom'] } : null;
    if (!err) {
      out.set(b58(p.payer), (out.get(b58(p.payer)) ?? 0n) - 5000n + (p.collects ? this.rewards : 0n));
      for (const t of p.transfers) {
        out.set(b58(t.from), (out.get(b58(t.from)) ?? 0n) - t.lamports);
        out.set(b58(t.to), (out.get(b58(t.to)) ?? 0n) + t.lamports);
      }
    }
    return { err, logs: err ? ['Program log: no'] : [], lamports: watch.map((k) => out.get(b58(k)) ?? null), units: 5000 };
  }
  async account(who: Bytes) {
    const k = b58(who);
    if (this.programOwned.has(k)) return { data: new Uint8Array(165), lamports: 2_039_280n, owner: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') };
    return this.balances.has(k) ? { data: new Uint8Array(0), lamports: this.bal(who), owner: SYSTEM_PROGRAM } : null;
  }
  async tokenBalance() {
    return 0n;
  }
  async steady() {
    return this;
  }
}

// ------------------------------------------------------------------ a world round it

// (the key of RFC 8032's first test: nobody's wallet)
export const SEED = hex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
export const KEY = b58(Uint8Array.from([...SEED, ...hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a')]));
export const TREASURY = new Keypair(KEY);
// (players' wallets: real addresses, each with a key somebody could hold, made from a number)
const wallets = new Map<number, string>();
export function wallet(n: number) {
  if (!wallets.has(n)) wallets.set(n, new Keypair(b58(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n >> 8 : i === 1 ? n & 255 : 42)))).address);
  return wallets.get(n)!;
}

export function world(treasurySol: number, env: Record<string, string> = {}) {
  const chain = new FakeChain();
  chain.balances.set(TREASURY.address, SOL(treasurySol));
  const store = new MemoryStore();
  let clock = Date.parse('2026-10-08T12:00:00Z');
  const w: World & { chain: FakeChain; store: MemoryStore; skip(ms: number): void; coinState: CoinState } = {
    cfg: config({ PAYOUTS: 'on', TREASURY_SECRET_KEY: KEY, ...env }),
    rpc: chain,
    store,
    chain,
    now: () => clock,
    // time passing is the chain moving on: a block every 400 ms
    sleep: async (ms) => {
      clock += ms;
      chain.tick(Math.max(1, Math.round(ms / 400)));
    },
    skip(ms) {
      clock += ms;
      chain.tick(Math.round(ms / 400));
    },
    random: Math.random,
    coinState: { unsupported: null, creator: TREASURY.publicKey, graduated: false, curve: 0n, pool: 0n, poolAccount: null, poolQuote: null },
    coin: async () => ({ ...w.coinState, curve: chain.rewards }),
  };
  return w;
}

let seq = 0;
export const tag = (w: World, to: string | number, over: Partial<Entry> = {}): Entry => ({ id: `t${(++seq).toString(36).padStart(9, '0')}`, at: new Date(w.now() - 1000).toISOString(), name: 'Sable', owner: 'Victim', wallet: typeof to === 'number' ? wallet(to) : to, ...over });
export const got = (w: { chain: FakeChain }, to: number | string) => w.chain.balances.get(typeof to === 'number' ? wallet(to) : to) ?? 0n;
export const tries = (w: { store: MemoryStore }, id: string) => [...w.store.files.keys()].filter((k) => k.startsWith(`ledger/try/${id}/`)).length;
