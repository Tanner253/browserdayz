// Just enough of Solana to pay somebody: keys, addresses, a transaction put together and
// signed by hand, and the handful of questions asked of an RPC node.
//
// Nothing here is borrowed from a library. This is the code that holds the treasury's key,
// and every package it pulled in would be one more thing able to read that key (a release
// of the usual Solana library did exactly that to its users in December 2024). Node signs;
// the rest is a few hundred lines that can be read in one sitting.

import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';

export type Bytes = Uint8Array;
export const LAMPORTS = 1_000_000_000;

// ------------------------------------------------------------------ base58

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58(bytes: Bytes): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (; n > 0n; n /= 58n) out = ALPHABET[Number(n % 58n)] + out;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out = '1' + out;
  return out;
}

export function unb58(text: string): Bytes {
  let n = 0n;
  for (const ch of text) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('not base58');
    n = n * 58n + BigInt(v);
  }
  const out: number[] = [];
  for (; n > 0n; n >>= 8n) out.unshift(Number(n & 255n));
  for (let i = 0; i < text.length && text[i] === '1'; i++) out.unshift(0);
  return Uint8Array.from(out);
}

/** An address as its 32 bytes. Throws on anything that is not one. */
export function address(text: string): Bytes {
  if (typeof text !== 'string' || text.length < 32 || text.length > 44) throw new Error('not a Solana address');
  const b = unb58(text);
  if (b.length !== 32) throw new Error('not a Solana address');
  return b;
}

export const same = (a: Bytes, b: Bytes) => a.length === b.length && a.every((v, i) => v === b[i]);
const cat = (...parts: (Bytes | number[])[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
const utf8 = (s: string) => new TextEncoder().encode(s);

export const SYSTEM_PROGRAM = new Uint8Array(32);
export const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const COMPUTE_BUDGET_PROGRAM = address('ComputeBudget111111111111111111111111111111');
export const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const WRAPPED_SOL = address('So11111111111111111111111111111111111111112');

// ------------------------------------------------------------------ keys

/**
 * The treasury's key, from the text it is kept as: either the 64 numbers in square brackets
 * that the Solana tools write, or the base58 string a wallet shows when it is asked to
 * export a private key. Both hold the 32-byte secret followed by the public key it makes.
 */
export class Keypair {
  readonly publicKey: Bytes;
  private key: KeyObject;

  constructor(secret: string) {
    const text = secret.trim();
    let raw: Bytes;
    try {
      raw = text.startsWith('[') ? Uint8Array.from(JSON.parse(text) as number[]) : unb58(text);
    } catch {
      throw new Error('the secret key is neither base58 nor a list of numbers');
    }
    if (raw.length !== 64 && raw.length !== 32) throw new Error(`the secret key is ${raw.length} bytes long: it should be 64`);
    // (PKCS#8 wrapping of an Ed25519 seed: fixed sixteen bytes, then the seed)
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(raw.subarray(0, 32))]);
    this.key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    this.publicKey = Uint8Array.from(createPublicKey(this.key).export({ type: 'spki', format: 'der' }).subarray(-32));
    if (raw.length === 64 && !same(raw.subarray(32), this.publicKey)) throw new Error('the two halves of the secret key do not belong together');
  }

  get address() {
    return b58(this.publicKey);
  }

  sign(message: Bytes): Bytes {
    return Uint8Array.from(edSign(null, Buffer.from(message), this.key));
  }
}

/** Is this signature really that key's, over that message? */
export function verify(message: Bytes, signature: Bytes, publicKey: Bytes): boolean {
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey)]);
  return edVerify(null, Buffer.from(message), createPublicKey({ key: der, format: 'der', type: 'spki' }), Buffer.from(signature));
}

// ------------------------------------------------------------------ addresses made from other things

const P = 2n ** 255n - 19n;
const mod = (a: bigint) => ((a % P) + P) % P;
function pow(base: bigint, e: bigint) {
  let r = 1n;
  for (base = mod(base); e > 0n; e >>= 1n, base = mod(base * base)) if (e & 1n) r = mod(r * base);
  return r;
}
const D = mod(-121665n * pow(121666n, P - 2n));

/** Whether 32 bytes are a point on the curve (an address somebody could hold the key to). */
export function onCurve(bytes: Bytes): boolean {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 127 : bytes[i]);
  const yy = mod(y * y);
  const u = mod(yy - 1n), v = mod(D * yy + 1n);
  // x squared is u / v: on the curve if that has a square root
  const x = mod(u * pow(v, 3n) * pow(u * pow(v, 7n), (P - 5n) / 8n));
  const vxx = mod(v * x * x);
  return vxx === u || vxx === mod(-u);
}

/** The address a program owns for these seeds: the first one, counting down, that is nobody's key. */
export function programAddress(seeds: (Bytes | string)[], program: Bytes): Bytes {
  const parts = seeds.map((s) => (typeof s === 'string' ? utf8(s) : s));
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash('sha256');
    for (const p of parts) h.update(p);
    const out = Uint8Array.from(h.update(Uint8Array.of(bump)).update(program).update('ProgramDerivedAddress').digest());
    if (!onCurve(out)) return out;
  }
  throw new Error('no address for these seeds');
}

/**
 * An address made from a wallet and a word: no key of its own, and only that wallet can
 * create an account there (see receipt, below).
 */
export function seeded(base: Bytes, seed: string, program: Bytes = SYSTEM_PROGRAM): Bytes {
  if (seed.length > 32) throw new Error('the seed is too long');
  return Uint8Array.from(createHash('sha256').update(base).update(seed).update(program).digest());
}

/** The account that holds somebody's tokens of one kind. */
export const tokenAccount = (owner: Bytes, mint: Bytes, tokenProgram = TOKEN_PROGRAM) => programAddress([owner, tokenProgram, mint], ASSOCIATED_TOKEN_PROGRAM);

// ------------------------------------------------------------------ transactions

export interface Meta {
  pubkey: Bytes;
  signer?: boolean;
  writable?: boolean;
}
export interface Instruction {
  program: Bytes;
  keys: Meta[];
  data: Bytes;
}

const u32 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
export function u64(n: bigint | number) {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  if (v < 0n || v >= 2n ** 64n) throw new Error('not a u64');
  for (let i = 0; i < 8; i++, v >>= 8n) out[i] = Number(v & 255n);
  return out;
}
export function readU64(b: Bytes, at: number) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[at + i] ?? 0);
  return v;
}
/** a length, the way a transaction writes one: seven bits at a time */
function compact(n: number) {
  const out: number[] = [];
  for (;;) {
    const low = n & 127;
    n >>= 7;
    if (!n) return [...out, low];
    out.push(low | 128);
  }
}

/** Lamports from one account to another. */
export const transfer = (from: Bytes, to: Bytes, lamports: bigint): Instruction => ({
  program: SYSTEM_PROGRAM,
  keys: [{ pubkey: from, signer: true, writable: true }, { pubkey: to, writable: true }],
  data: cat(u32(2), u64(lamports)),
});
/** what an account with nothing in it must hold for the chain to keep it */
export const EMPTY_ACCOUNT_RENT = 890_880n;

/**
 * Creates an empty account at seeded(from, seed), paid for by `from`. It fails if there is
 * already an account there, and takes the whole transaction down with it: put in front of a
 * payment, it makes that payment one that can only ever happen once, whatever is sent and
 * however many times. The account is the receipt.
 */
export function receipt(from: Bytes, seed: string): Instruction {
  const text = utf8(seed);
  return {
    program: SYSTEM_PROGRAM,
    keys: [{ pubkey: from, signer: true, writable: true }, { pubkey: seeded(from, seed), writable: true }],
    // create-with-seed (3): the base, the seed with its length, what it holds, its size, who owns it
    data: cat(u32(3), from, u64(text.length), text, u64(EMPTY_ACCOUNT_RENT), u64(0), SYSTEM_PROGRAM),
  };
}

/** How much work the transaction may do, and what it bids per unit of it (millionths of a lamport). */
export const computeLimit = (units: number): Instruction => ({ program: COMPUTE_BUDGET_PROGRAM, keys: [], data: cat([2], u32(units)) });
export const computePrice = (microLamports: number): Instruction => ({ program: COMPUTE_BUDGET_PROGRAM, keys: [], data: cat([3], u64(microLamports)) });
/** A line of text that goes on the chain with the transaction. */
export const memo = (text: string): Instruction => ({ program: MEMO_PROGRAM, keys: [], data: utf8(text) });
/** Opens somebody's token account if they have none yet (and does nothing if they have). */
export const openTokenAccount = (payer: Bytes, owner: Bytes, mint: Bytes, tokenProgram = TOKEN_PROGRAM): Instruction => ({
  program: ASSOCIATED_TOKEN_PROGRAM,
  keys: [
    { pubkey: payer, signer: true, writable: true },
    { pubkey: tokenAccount(owner, mint, tokenProgram), writable: true },
    { pubkey: owner },
    { pubkey: mint },
    { pubkey: SYSTEM_PROGRAM },
    { pubkey: tokenProgram },
  ],
  data: Uint8Array.of(1),
});
/** Closes a token account and sends what it held, as plain SOL when it was wrapped SOL, to `to`. */
export const closeTokenAccount = (account: Bytes, to: Bytes, owner: Bytes, tokenProgram = TOKEN_PROGRAM): Instruction => ({
  program: tokenProgram,
  keys: [{ pubkey: account, writable: true }, { pubkey: to, writable: true }, { pubkey: owner, signer: true }],
  data: Uint8Array.of(9),
});

/** The part of a transaction that is signed: who is involved, a recent block, what to do. */
export function message(payer: Bytes, instructions: Instruction[], blockhash: string): Bytes {
  const metas = new Map<string, Meta>();
  const add = (m: Meta) => {
    const k = b58(m.pubkey);
    const had = metas.get(k);
    metas.set(k, { pubkey: m.pubkey, signer: !!(had?.signer || m.signer), writable: !!(had?.writable || m.writable) });
  };
  add({ pubkey: payer, signer: true, writable: true });
  for (const ix of instructions) {
    for (const m of ix.keys) add(m);
    add({ pubkey: ix.program });
  }
  // the order the chain wants: those who sign and are changed, sign only, changed only, neither
  const rank = (m: Meta) => (m.signer ? 0 : 2) + (m.writable ? 0 : 1);
  const all = [...metas.values()];
  const keys = [all[0], ...all.slice(1).sort((a, b) => rank(a) - rank(b))];
  if (keys.length > 64) throw new Error('too many accounts for one transaction');
  const index = new Map(keys.map((m, i) => [b58(m.pubkey), i]));
  const body: (Bytes | number[])[] = [
    [keys.filter((m) => m.signer).length, keys.filter((m) => m.signer && !m.writable).length, keys.filter((m) => !m.signer && !m.writable).length],
    compact(keys.length),
    ...keys.map((m) => m.pubkey),
    address(blockhash),
    compact(instructions.length),
  ];
  for (const ix of instructions) body.push([index.get(b58(ix.program))!], compact(ix.keys.length), ix.keys.map((m) => index.get(b58(m.pubkey))!), compact(ix.data.length), ix.data);
  return cat(...body);
}

export interface Signed {
  /** the whole transaction, ready to send */
  wire: Bytes;
  /** its name on the chain, known the moment it is signed */
  signature: string;
}

/** One signer, who also pays the fee. */
export function signed(payer: Keypair, instructions: Instruction[], blockhash: string): Signed {
  const msg = message(payer.publicKey, instructions, blockhash);
  const sig = payer.sign(msg);
  const wire = cat([1], sig, msg);
  if (wire.length > 1232) throw new Error('the transaction is too big');
  return { wire, signature: b58(sig) };
}

/** The same transaction with an empty signature: for asking a node what it would do, never for sending. */
export function unsigned(payer: Bytes, instructions: Instruction[], blockhash: string): Bytes {
  return cat([1], new Uint8Array(64), message(payer, instructions, blockhash));
}

// ------------------------------------------------------------------ the node

export interface Status {
  slot: number;
  /** null when it went through */
  err: unknown;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
}

export class Rpc {
  private urls: string[];
  /** @param urls one address, or several with commas between: questions go to the first that answers */
  constructor(urls: string, private timeoutMs = 9000) {
    this.urls = urls.split(',').map((u) => u.trim()).filter(Boolean);
    if (!this.urls.length) throw new Error('no RPC address');
  }

  private async ask<T>(url: string, method: string, params: unknown[]): Promise<T> {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!r.ok) throw new Error(`${method}: the node answered ${r.status}`);
    const j = (await r.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
    if (j.error) throw Object.assign(new Error(`${method}: ${j.error.message}`), { rpc: j.error });
    return j.result as T;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    let last: unknown;
    for (const url of this.urls) {
      try {
        return await this.ask<T>(url, method, params);
      } catch (e) {
        last = e;
        // what the node said about the request itself is the answer; only a node that could not be asked is passed over
        if ((e as { rpc?: unknown }).rpc) throw e;
      }
    }
    throw last;
  }

  /**
   * One node only, the first that answers. Two questions whose answers have to agree (how
   * far has the chain got, and has it seen this transaction) must not be put to two nodes,
   * one of which may be a little behind the other.
   */
  async steady(): Promise<Rpc> {
    for (const url of this.urls) {
      const one = new Rpc(url, this.timeoutMs);
      if (await one.call('getHealth').then(() => true, () => false)) return one;
    }
    throw new Error('no node is answering');
  }

  async balance(who: Bytes): Promise<bigint> {
    const r = await this.call<{ value: number }>('getBalance', [b58(who), { commitment: 'confirmed' }]);
    return BigInt(r.value);
  }

  async latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return (await this.call<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
  }

  /** how far the chain has got, counting only blocks that can no longer be undone */
  blockHeight(): Promise<number> {
    return this.call<number>('getBlockHeight', [{ commitment: 'finalized' }]);
  }

  /** Hands a signed transaction to every node we know (the same one twice is still one payment). */
  async send(tx: Signed): Promise<void> {
    const wire = Buffer.from(tx.wire).toString('base64');
    const tries = await Promise.allSettled(this.urls.map((u) => this.ask<string>(u, 'sendTransaction', [wire, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 }])));
    if (tries.some((t) => t.status === 'fulfilled')) return;
    throw (tries[0] as PromiseRejectedResult).reason;
  }

  async statuses(signatures: string[]): Promise<(Status | null)[]> {
    if (!signatures.length) return [];
    return (await this.call<{ value: (Status | null)[] }>('getSignatureStatuses', [signatures, { searchTransactionHistory: true }])).value;
  }

  /** What a transaction would do if it were sent: nothing is signed, nothing moves. */
  async simulate(wire: Bytes, watch: Bytes[] = []): Promise<{ err: unknown; logs: string[]; lamports: (bigint | null)[]; units: number }> {
    const r = await this.call<{ value: { err: unknown; logs: string[] | null; accounts: ({ lamports: number } | null)[] | null; unitsConsumed?: number } }>('simulateTransaction', [
      Buffer.from(wire).toString('base64'),
      { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: watch.map(b58) } },
    ]);
    return { err: r.value.err, logs: r.value.logs ?? [], lamports: (r.value.accounts ?? []).map((a) => (a ? BigInt(a.lamports) : null)), units: r.value.unitsConsumed ?? 0 };
  }

  /**
   * What a transaction that has arrived did to one wallet's balance, read off the transaction
   * itself (so nothing else going on at the time is mixed into it). Null if the node cannot say.
   */
  async gained(signature: string, who: Bytes): Promise<bigint | null> {
    const r = await this.call<{ transaction: { message: { accountKeys: string[] } }; meta: { err: unknown; preBalances: number[]; postBalances: number[] } | null } | null>('getTransaction', [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    const i = r?.transaction.message.accountKeys.indexOf(b58(who)) ?? -1;
    if (!r?.meta || r.meta.err || i < 0) return null;
    return BigInt(r.meta.postBalances[i]) - BigInt(r.meta.preBalances[i]);
  }

  /** An account's contents, or null if there is no such account. */
  async account(who: Bytes): Promise<{ data: Bytes; lamports: bigint; owner: Bytes } | null> {
    const r = await this.call<{ value: { data: [string, string]; lamports: number; owner: string } | null }>('getAccountInfo', [b58(who), { encoding: 'base64', commitment: 'confirmed' }]);
    return r.value ? { data: Uint8Array.from(Buffer.from(r.value.data[0], 'base64')), lamports: BigInt(r.value.lamports), owner: address(r.value.owner) } : null;
  }

  /** how many of a token an account holds, in the token's smallest unit (0 if there is no such account) */
  async tokenBalance(account: Bytes): Promise<bigint> {
    const a = await this.account(account);
    return a && a.data.length >= 72 ? readU64(a.data, 64) : 0n;
  }
}
