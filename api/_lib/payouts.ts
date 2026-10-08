// Paying for dog tags. A tag cashed in is paid out of the treasury to the wallet the player
// gave; the treasury is kept topped up by collecting the coin's creator rewards; and every
// payment is written in a book the payouts page is drawn from, each with the transaction
// anybody can look up.
//
// The treasury is one wallet: the one that made the coin on pump.fun, whose key is given in
// TREASURY_SECRET_KEY. Rewards are collected into it and tags are paid out of it, and nothing
// else moves.
//
// What a tag pays: a share of what the treasury holds at that moment (two per cent unless
// set otherwise), and never less than a floor (0.02 SOL). A full treasury pays well; an
// empty one pays the floor until it cannot, and then tags wait for the next rewards.
//
// The one thing that must never happen is a tag paid twice, and it is the chain that sees to
// it, not this code. Every payment begins by creating a small account whose address is made
// from the treasury and the tag: the receipt. Creating an account that already exists fails,
// and takes the rest of the transaction with it. So whatever is sent, however many times, by
// however many workers, with whatever this code believes at the time: the first payment for
// a tag to arrive is the only one that ever can. "Has this tag been paid?" is likewise
// answered by looking for its receipt, which any node can say without searching its history.
//
// The rest is so that money is not wasted and the limits hold:
//   * each attempt is written in the book, with the tag's place in the day's limits, before
//     it is sent, by a write that fails if anybody else has written since the book was read.
//     So two workers cannot both begin an attempt from the same reading, two tags at once
//     cannot both slip under a limit, and a new attempt is not made while an old one might
//     still arrive;
//   * the book could be lost and no tag would be paid twice because of it.

import { createHash } from 'node:crypto';
import { EMPTY_ACCOUNT_RENT, Keypair, LAMPORTS, SYSTEM_PROGRAM, WRAPPED_SOL, address, b58, closeTokenAccount, computeLimit, computePrice, memo, onCurve, receipt, same, seeded, signed, tokenAccount, transfer, unsigned, type Bytes, type Instruction, type Rpc, type Signed, type Status } from './solana.js';
import { claimCurve, claimPool, state as coinState, type CoinState } from './pump.js';
import type { Store } from './store.js';

// ------------------------------------------------------------------ settings

export interface Config {
  /** 'on' pays; 'dry' works out what it would pay and tries it without sending; 'off' only keeps the list */
  mode: 'off' | 'dry' | 'on';
  /** why it is not on, when it was asked to be */
  problem: string | null;
  key: Keypair | null;
  treasury: Bytes | null;
  /** pay out of the wallet whose key was given even if it is not the wallet that made the coin (see setup) */
  anyTreasury: boolean;
  rpc: string;
  mint: Bytes;
  /** a tag pays this part of what the treasury holds (0.02 = two per cent)... */
  share: number;
  /** ...but not less than this, nor more than this */
  floor: bigint;
  ceiling: bigint;
  /** lamports never spent: the wallet's own rent, and fees */
  keep: bigint;
  /** no more than this part of the treasury leaves it in one day (UTC), and no wallet is paid for more tags than this in one */
  dayShare: number;
  walletDayTags: number;
  /** rewards are collected when at least this much is waiting */
  claimAt: bigint;
  /** what is bid per unit of work, in millionths of a lamport: enough to be taken up promptly */
  bid: number;
}

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const DEFAULT_MINT = 'GvfAzdPF466PJsPJMzXQeX3TSqmJm9YxAG8xBJ6ypump';

const lamports = (sol: number) => BigInt(Math.round(sol * LAMPORTS));
export const sol = (l: bigint | number) => Number(l) / LAMPORTS;

function num(text: string | undefined, fallback: number, min: number, max: number) {
  const v = text === undefined || text.trim() === '' ? fallback : Number(text);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Everything that can be set, from the environment. Nothing in here ever goes into a log or a page. */
export function config(env: Record<string, string | undefined> = process.env): Config {
  const asked = (env.PAYOUTS ?? '').trim().toLowerCase();
  let mode: Config['mode'] = asked === 'on' || asked === 'dry' ? asked : 'off';
  let problem: string | null = null;
  let key: Keypair | null = null;
  let treasury: Bytes | null = null;
  let mint = address(DEFAULT_MINT);
  let rpc = DEFAULT_RPC;
  try {
    if (env.PUMP_MINT) mint = address(env.PUMP_MINT.trim());
    if (env.TREASURY_ADDRESS) treasury = address(env.TREASURY_ADDRESS.trim());
    if (env.SOLANA_RPC_URL?.trim()) {
      rpc = env.SOLANA_RPC_URL.trim();
      // (said without repeating it: the address of a paid-for node is itself a secret)
      if (!rpc.split(',').every((u) => /^https:\/\/[^\s/]+/.test(u.trim()))) throw new Error('SOLANA_RPC_URL is not an https address');
    }
    if (env.TREASURY_SECRET_KEY) {
      key = new Keypair(env.TREASURY_SECRET_KEY);
      if (treasury && !same(treasury, key.publicKey)) throw new Error('TREASURY_SECRET_KEY is not the key of TREASURY_ADDRESS');
      treasury = key.publicKey;
    }
    if (mode === 'on' && !key) throw new Error('PAYOUTS is on but there is no TREASURY_SECRET_KEY');
    if (mode === 'dry' && !treasury) throw new Error('a dry run needs TREASURY_ADDRESS (or the key)');
  } catch (e) {
    problem = (e as Error).message;
    mode = 'off';
    key = null;
    rpc = DEFAULT_RPC;
  }
  const floor = lamports(num(env.TAG_PAY_MIN_SOL, 0.02, 0.001, 10));
  return {
    mode,
    problem,
    key,
    treasury,
    anyTreasury: /^(yes|true|1|on)$/i.test((env.TREASURY_NOT_THE_MAKER ?? '').trim()),
    rpc,
    mint,
    share: num(env.TAG_PAY_PERCENT, 2, 0, 25) / 100,
    floor,
    ceiling: lamports(Math.max(sol(floor), num(env.TAG_PAY_MAX_SOL, 5, 0.001, 1000))),
    keep: lamports(num(env.TREASURY_KEEP_SOL, 0.01, 0.002, 1000)),
    dayShare: num(env.PAYOUT_DAY_CAP_PERCENT, 50, 1, 100) / 100,
    walletDayTags: Math.round(num(env.PAYOUT_WALLET_DAY_TAGS, 3, 1, 1000)),
    claimAt: lamports(num(env.CLAIM_MIN_SOL, 0.05, 0.001, 1000)),
    bid: Math.round(num(env.PRIORITY_MICROLAMPORTS, 20_000, 0, 5_000_000)),
  };
}

/** What one tag pays out of a treasury holding this much. */
export function price(balance: bigint, cfg: Pick<Config, 'share' | 'floor' | 'ceiling' | 'keep'>): bigint {
  const spendable = balance > cfg.keep ? balance - cfg.keep : 0n;
  const part = (spendable * BigInt(Math.round(cfg.share * 1_000_000))) / 1_000_000n;
  return part < cfg.floor ? cfg.floor : part > cfg.ceiling ? cfg.ceiling : part;
}

// ------------------------------------------------------------------ what is kept

/** a tag cashed in, as the game server reports it */
export interface Entry {
  id: string;
  at: string;
  name: string;
  owner: string;
  wallet: string;
}

/**
 * What a tag goes by everywhere but in the game server's own call: in the book, on the page,
 * in the note on its payment, and in the address of its receipt. Made from the tag's id and
 * not the id itself (the id is what the game server calls this site with, and is not given
 * out).
 */
export const refOf = (id: string) => createHash('sha256').update(`ZONA dog tag ${id}`).digest('hex').slice(0, 24);

/** a tag as the book knows it */
export interface Tag {
  ref: string;
  at: string;
  name: string;
  owner: string;
  wallet: string;
}
export const tagOf = (e: Entry): Tag => ({ ref: refOf(e.id), at: e.at, name: e.name, owner: e.owner, wallet: e.wallet });

/**
 * Why a tag is waiting, where that says when it is worth looking at again: asking costs, and
 * most waits end at a time that can be told without asking.
 *   funds  the treasury is short: when it holds enough again
 *   day    a limit on the day: tomorrow
 *   setup  payouts are not set up to pay (a dry run, the wrong key): when they are
 *   hand   something a person has to look at: never by itself
 */
export type Hold = 'funds' | 'day' | 'setup' | 'hand';

export type Outcome =
  | { state: 'paid'; lamports: number; signature: string; at: string; receipt?: string }
  /** its attempt is written down, its place in the day's limits is taken, and its payment is on the way */
  | { state: 'sending'; lamports: number; signature: string }
  /** will be paid when it can be: nothing more is needed from the player */
  | { state: 'waiting'; why: string; hold?: Hold }
  /** will not be paid, and why */
  | { state: 'skipped'; why: string }
  /** payouts were not switched on when it was cashed in: listed only */
  | { state: 'off' };

/** one attempt at one payment: written in the book before the transaction is sent */
export interface Try {
  signature: string;
  /** the last block in which it can be included */
  lastValid: number;
  /** the signed transaction itself: sending it again is the same payment, not a second one */
  wire: string;
  at: string;
  /** the address of the receipt it leaves if it arrives */
  receipt: string;
}

export interface Row extends Tag {
  state: Outcome['state'];
  why?: string;
  hold?: Hold;
  /** the day (UTC) it was told to wait */
  heldOn?: string;
  lamports?: number;
  signature?: string;
  paidAt?: string;
  /** the day (UTC) its place in the limits was taken: what the day's limits count */
  day?: string;
  /** the address of its receipt on the chain, once it is paid */
  receipt?: string;
  /** the attempts made at paying it, while it is not paid */
  tries?: Try[];
  /** left open by the version before this one, whose payments left no receipt: never paid by the machine now */
  legacy?: boolean;
}

export interface Claim {
  at: string;
  signature: string;
  /** what it brought in */
  lamports: number;
  from: 'curve' | 'pool';
}

export interface Book {
  v: 1;
  /** when payouts were first switched on: nothing cashed in before this is paid by the machine */
  since: string | null;
  /** the tags cashed in before there was a book have been read into it */
  seeded?: boolean;
  /** newest first; only the latest are kept, the totals count everything */
  rows: Row[];
  tags: number;
  paid: number;
  paidLamports: number;
  claims: Claim[];
  claimedLamports: number;
  /** what went wrong the last time rewards were tried for, if anything did */
  claimNote: string;
  /** the most the treasury has been seen to hold on the latest day anything was paid: what that day's limit is a share of */
  most?: { day: string; lamports: number };
}

/** the book as it was read, and the mark of that version (null: there is no book yet) */
export interface Held {
  book: Book;
  mark: string | null;
}

const BOOK = 'ledger/book.json';
const ROWS_KEPT = 500;
const emptyBook = (): Book => ({ v: 1, since: null, rows: [], tags: 0, paid: 0, paidLamports: 0, claims: [], claimedLamports: 0, claimNote: '' });
const open = (r: Row) => r.state === 'sending' || r.state === 'waiting';

/** (rows written before a tag had a reference carried its id: they are given their reference, and the id is dropped) */
function tidy(book: Book): Book {
  for (const r of book.rows as (Row & { id?: string })[]) {
    if (!r.id) continue;
    r.ref = refOf(r.id);
    delete r.id;
    if (open(r)) r.legacy = true;
  }
  return book;
}

/** The book as it is now. (Counted by the file service: for the way to a write.) */
export async function freshBook(store: Store): Promise<Held> {
  const had = await store.read<Book>(BOOK);
  return { book: tidy(had?.data ?? emptyBook()), mark: had?.mark ?? null };
}
export const readBook = async (store: Store) => (await freshBook(store)).book;

/** The book as it was up to a minute ago. (Costs nothing: for showing, and for what cannot be taken back.) */
export async function glanceBook(store: Store): Promise<Book> {
  return tidy((await store.glance<Book>(BOOK).catch(() => null)) ?? emptyBook());
}

/**
 * Changes the book, starting again from the latest copy if somebody else changed it meanwhile
 * (after a short wait of no fixed length, so that several who collide do not collide again).
 * @param change returns false to leave the book as it is: nothing is then written
 * @param from the book as the caller last read or wrote it, to save reading it again
 */
export async function editBook(w: Pick<World, 'store' | 'sleep' | 'random' | 'now'>, change: (book: Book) => unknown, from?: Held): Promise<Held> {
  let at: Held = from ? { book: structuredClone(from.book), mark: from.mark } : await freshBook(w.store);
  for (let i = 0; ; i++) {
    const book = at.book;
    if (change(book) === false) return at;
    book.rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    // the latest are kept, and with them every one not settled yet, and every one the day's limits still count
    const recent = dayOf(w.now() - 24 * 3600 * 1000);
    if (book.rows.length > ROWS_KEPT) book.rows = [...book.rows.slice(0, ROWS_KEPT), ...book.rows.slice(ROWS_KEPT).filter((r) => open(r) || (r.day ?? '') >= recent)];
    book.claims.length = Math.min(book.claims.length, 100);
    const mark = await w.store.swap(BOOK, book, at.mark);
    if (mark !== false) return { book, mark };
    if (i >= 40) throw new Error('the book is busy');
    await w.sleep(20 + w.random() * 120 * Math.min(i + 1, 8));
    at = await freshBook(w.store);
  }
}

/** Puts a tag and what became of it in the book (a tag already down as paid stays as it is). */
export function enter(book: Book, t: Tag, o: Outcome, day: string): Row {
  let row = book.rows.find((r) => r.ref === t.ref);
  if (!row) {
    row = { ref: t.ref, at: t.at, name: t.name, owner: t.owner, wallet: t.wallet, state: 'off' };
    book.rows.push(row);
    book.tags++;
  }
  if (row.state === 'paid') return row;
  row.state = o.state;
  row.why = 'why' in o ? o.why : undefined;
  row.hold = o.state === 'waiting' ? o.hold : undefined;
  row.heldOn = o.state === 'waiting' && o.hold ? day : undefined;
  if (o.state === 'paid' || o.state === 'sending') {
    row.lamports = o.lamports;
    if (o.signature) row.signature = o.signature;
    row.day ??= day;
  }
  if (o.state === 'paid') {
    row.paidAt = o.at;
    row.receipt = o.receipt || undefined;
    delete row.tries;
    delete row.legacy;
    book.paid++;
    book.paidLamports += o.lamports;
  }
  return row;
}

/** what the book says became of a tag */
const told = (r: Row): Outcome =>
  r.state === 'paid'
    ? { state: 'paid', lamports: r.lamports ?? 0, signature: r.signature ?? '', at: r.paidAt ?? r.at, receipt: r.receipt }
    : r.state === 'sending'
      ? { state: 'sending', lamports: r.lamports ?? 0, signature: r.signature ?? '' }
      : r.state === 'waiting'
        ? { state: 'waiting', why: r.why ?? '', hold: r.hold }
        : r.state === 'skipped'
          ? { state: 'skipped', why: r.why ?? '' }
          : { state: 'off' };

/** whether the book already says this of the tag (so that nothing is written that says nothing new) */
const says = (r: Row, o: Outcome, day: string) =>
  r.state === o.state &&
  r.why === ('why' in o ? o.why : undefined) &&
  (o.state !== 'waiting' || (r.hold === o.hold && (o.hold !== 'day' || r.heldOn === day))) &&
  (!('signature' in o) || !o.signature || r.signature === o.signature);

// ------------------------------------------------------------------ the world it runs in

/** the questions asked of the chain (the real thing is Rpc; the tests bring their own) */
export type Chain = Pick<Rpc, 'balance' | 'latestBlockhash' | 'blockHeight' | 'send' | 'statuses' | 'simulate' | 'account' | 'tokenBalance' | 'gained'> & { steady(): Promise<Pick<Rpc, 'blockHeight' | 'statuses'>> };

export interface World {
  cfg: Config;
  rpc: Chain;
  store: Store;
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  /** where the coin's rewards stand (pump.ts, unless a test says otherwise) */
  coin?: (rpc: Chain, mint: Bytes) => Promise<CoinState>;
  /** answers kept for a short while, so that many asking at once is one asking (the real thing has one; the tests mostly do without) */
  memo?: Map<string, { at: number; value: Promise<unknown> }>;
}

/** An answer no older than this, made afresh if there is none. A failure is not kept. */
export function cached<T>(w: World, name: string, ms: number, make: () => Promise<T>): Promise<T> {
  if (!w.memo) return make();
  const had = w.memo.get(name);
  if (had && w.now() - had.at < ms) return had.value as Promise<T>;
  const value = make();
  w.memo.set(name, { at: w.now(), value });
  value.catch(() => w.memo?.get(name)?.value === value && w.memo.delete(name));
  return value;
}

const iso = (ms: number) => new Date(ms).toISOString();
export const dayOf = (ms: number) => iso(ms).slice(0, 10);

/** a tag older than this is not paid by the machine any more */
const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
const MAX_TRIES = 5;
/** blocks past a transaction's last chance before it is given up on, on top of only counting blocks that cannot be undone */
const DEAD_MARGIN = 20;
/** how long one request waits to see its payment arrive (a claim and a payment in one request must both fit in the minute a request is allowed) */
const WATCH_MS = 18_000;
/** fees, with room to spare */
const FEE_ROOM = 20_000n;
/** work allowed: a payment with its receipt and note uses about fifteen thousand units; a claim, about sixty thousand */
const PAY_UNITS = 40_000;
const CLAIM_UNITS = 250_000;

const landed = (s: Pick<Status, 'err' | 'confirmationStatus'> | null | undefined) => !!s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized');

/**
 * What went wrong, in words fit to be shown to anybody. Only what this code itself says is
 * passed on: anything else (a library's message may quote an address it was given, and the
 * address of a paid-for node is a secret) is replaced.
 */
export function plain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/^[a-zA-Z]+: the node answered \d+$/.test(m) || m === 'the book is busy' || m === 'no node is answering' || m === 'the file store is serving an old copy') return m;
  if (/timeout|aborted/i.test(m)) return 'the chain did not answer in time';
  return 'the chain or the file store could not be reached';
}

/**
 * For the host's own log, which only the owner can read: what a node said of a transaction it
 * would not take. Only the node's own words about the transaction, never anything of ours
 * (an error from the connection itself may quote the node's address, and is left out).
 */
const refused = (what: string) => (e: unknown) => {
  const said = (e as { rpc?: { code?: number; message?: string } }).rpc;
  if (said) console.warn(`${what}: the node would not take it (${said.code}): ${String(said.message).slice(0, 300)}`);
};

async function watch(w: World, tx: Signed, forMs = WATCH_MS): Promise<boolean> {
  for (let waited = 0; waited < forMs; waited += 1200) {
    await w.sleep(1200);
    const [s] = await w.rpc.statuses([tx.signature]).catch(() => [null]);
    if (landed(s)) return true;
    // (it got in and failed: no amount of waiting changes that)
    if (s?.err && s.confirmationStatus === 'finalized') return false;
  }
  return false;
}

/** where the coin's rewards stand, asked of the chain at most twice a minute */
const coin = (w: World) => cached(w, 'coin', 30_000, () => (w.coin ?? coinState)(w.rpc, w.cfg.mint));
const treasuryHolds = (w: World) => cached(w, 'balance', 15_000, () => w.rpc.balance(w.cfg.treasury!));

/**
 * Why nothing can be paid as things are set up, or null if all is in order. The treasury has
 * to be the wallet that made the coin: that is the only wallet its rewards can be collected
 * into, and a key given by mistake for some other wallet would otherwise pay tags out of
 * that wallet until it was empty.
 */
export async function setup(w: World): Promise<string | null> {
  const cfg = w.cfg;
  if (cfg.mode !== 'on' || !cfg.treasury || cfg.anyTreasury) return null;
  const s = await coin(w);
  if (!s.creator) return 'the wallet that made the coin could not be told from the chain';
  return same(s.creator, cfg.treasury) ? null : `the key given is for the wallet ${b58(cfg.treasury)}, and the coin was made by ${b58(s.creator)}: nothing is paid until the key of that wallet is given`;
}

/** Whether a tag that is not settled is worth looking at again now. */
async function due(w: World, r: Row): Promise<boolean> {
  if (r.state === 'sending') return true;
  if (r.state !== 'waiting' || r.hold === 'hand') return false;
  if (r.hold === 'day') return r.heldOn !== dayOf(w.now());
  if (r.hold === 'setup') return w.cfg.mode === 'on' && (await setup(w).catch(() => 'not known')) === null;
  if (r.hold === 'funds' && w.cfg.treasury) {
    // (when the treasury, with whatever rewards could be collected into it, would cover a tag)
    const has = await treasuryHolds(w);
    const s = w.cfg.mode === 'on' ? await coin(w).catch(() => null) : null;
    const more = s && s.creator && same(s.creator, w.cfg.treasury) && !s.unsupported ? s.curve + s.pool : 0n;
    return has + more >= price(has + more, w.cfg) + EMPTY_ACCOUNT_RENT + FEE_ROOM + w.cfg.keep;
  }
  return true;
}

// ------------------------------------------------------------------ paying one tag

/**
 * Pays a tag, or says why not, or finds that it has been paid already. Safe to call again
 * and again for the same tag, and from two places at once.
 * @param at the book as last read; left holding the book as this last wrote it
 */
async function settle(w: World, t: Tag, at: { held: Held }): Promise<Outcome> {
  const cfg = w.cfg;
  if (cfg.mode === 'off' || !cfg.treasury) return { state: 'off' };
  const treasury = cfg.treasury;
  const now = w.now();
  const had = at.held.book.rows.find((r) => r.ref === t.ref);
  const tries = had?.tries ?? [];

  // begun by the version before this one, whose payments left no receipt to tell by: paid if
  // its payment is seen to have arrived, and otherwise for a person to settle, never the machine
  if (had?.legacy) {
    const [s] = had.signature ? await w.rpc.statuses([had.signature]) : [null];
    if (landed(s)) return { state: 'paid', lamports: had.lamports ?? 0, signature: had.signature!, at: iso(now) };
    return { state: 'skipped', why: 'left unfinished by an earlier version of this system: to be settled by hand' };
  }

  if (!t.wallet) return { state: 'skipped', why: 'no wallet given' };
  let to: Bytes;
  try {
    to = address(t.wallet);
  } catch {
    return { state: 'skipped', why: 'not a wallet address' };
  }
  if (same(to, treasury)) return { state: 'skipped', why: 'not a wallet that can be paid' };

  // --- has it been paid? The chain says: its receipt is there, or it is not.
  const mine = b58(seeded(treasury, t.ref));
  for (const place of new Set([mine, ...tries.map((x) => x.receipt)])) {
    if (!(await w.rpc.account(address(place)))) continue;
    // an account where its receipt would go, and no attempt of ours on record: not ours. Nothing is sent.
    const made = tries.filter((x) => x.receipt === place);
    if (!made.length) return { state: 'waiting', why: 'the address of its receipt is already in use: this one needs looking at', hold: 'hand' };
    // (which of the attempts it was, if the node remembers; the last of them if it does not)
    const seen = await w.rpc.statuses(made.map((x) => x.signature)).catch(() => [] as (Status | null)[]);
    const hit = made.find((_, i) => landed(seen[i])) ?? made[made.length - 1];
    return { state: 'paid', lamports: had?.lamports ?? 0, signature: hit.signature, at: hit.at, receipt: place };
  }

  // --- attempts made before: is one of them still on its way?
  if (tries.length) {
    // (how far the chain has got and what it has seen are asked of one node, so that the two answers agree)
    const node = await w.rpc.steady();
    const height = await node.blockHeight();
    const seen = await node.statuses(tries.map((x) => x.signature));
    const hit = tries.findIndex((_, i) => landed(seen[i]));
    if (hit >= 0) return { state: 'paid', lamports: had?.lamports ?? 0, signature: tries[hit].signature, at: tries[hit].at, receipt: tries[hit].receipt };
    const gone = (x: Try, i: number) => (seen[i] ? !!seen[i]!.err && seen[i]!.confirmationStatus === 'finalized' : height > x.lastValid + DEAD_MARGIN);
    const alive = tries.filter((x, i) => !gone(x, i));
    if (alive.length) {
      const last = alive[alive.length - 1];
      // the very same transaction once more does no harm and may help it along
      await w.rpc.send({ wire: Uint8Array.from(Buffer.from(last.wire, 'base64')), signature: last.signature }).catch(() => {});
      return { state: 'sending', lamports: had?.lamports ?? 0, signature: last.signature };
    }
    if (tries.length >= MAX_TRIES) return { state: 'waiting', why: `${MAX_TRIES} attempts did not go through: this one needs looking at`, hold: 'hand' };
  } else {
    // --- whether it is to be paid at all (asked afresh each time until its first attempt)
    if (!(now - Date.parse(t.at) < MAX_AGE_MS)) return { state: 'skipped', why: 'cashed in more than three days ago' };
    const since = at.held.book.since;
    if (since && Date.parse(t.at) < Date.parse(since)) return { state: 'skipped', why: 'cashed in before automatic payouts began' };
    const wrong = await setup(w);
    if (wrong) return { state: 'waiting', why: wrong, hold: 'setup' };
    const there = await w.rpc.account(to);
    if (there && !same(there.owner, SYSTEM_PROGRAM)) return { state: 'skipped', why: 'that address is not a wallet (it belongs to a program)' };
    // an address nobody can hold the key to, and that has never been used: money sent there is gone
    if (!there && !onCurve(to)) return { state: 'skipped', why: 'that address is not a wallet anybody holds the key to' };
  }

  // --- how much (what the first attempt set out to pay is what every later one pays), and whether the treasury can cover it
  let balance = await w.rpc.balance(treasury);
  const amount = tries.length && had?.lamports ? BigInt(had.lamports) : price(balance, cfg);
  const short = () => balance < amount + EMPTY_ACCOUNT_RENT + FEE_ROOM + cfg.keep;
  if (short() && cfg.mode === 'on') {
    // bring the rewards home first, whatever there is of them
    await claim(w, true).catch(() => {});
    balance = await w.rpc.balance(treasury);
  }
  if (short()) return { state: 'waiting', why: 'the treasury is too low: paid when the next creator rewards come in', hold: 'funds' };

  // --- the payment: its receipt first (so it can only ever happen once), the money, and a note saying what it is for
  const { blockhash, lastValidBlockHeight } = await w.rpc.latestBlockhash();
  const todo = [computeLimit(PAY_UNITS), computePrice(cfg.bid), receipt(treasury, t.ref), transfer(treasury, to, amount), memo(`ZONA dog tag ${t.ref}`)];
  if (cfg.mode === 'dry' || !cfg.key) {
    // a dry run stops here: put together and tried on a node, and not sent
    const sim = await w.rpc.simulate(unsigned(treasury, todo, blockhash));
    return { state: 'waiting', why: `dry run: would pay ${sol(amount)} SOL (${sim.err ? 'and it would FAIL: ' + JSON.stringify(sim.err) : 'tried, and it would go through'})`, hold: 'setup' };
  }

  // --- sign it; write it in the book, and with it the tag's place in the day's limits; and only then send it
  const tx = signed(cfg.key, todo, blockhash);
  const attempt: Try = { signature: tx.signature, lastValid: lastValidBlockHeight, wire: Buffer.from(tx.wire).toString('base64'), at: iso(now), receipt: mine };
  const day = dayOf(now);
  const said: { wait: Outcome | null; theirs: boolean } = { wait: null, theirs: false };
  at.held = await editBook(
    w,
    (b) => {
      said.wait = null;
      said.theirs = false;
      const row = b.rows.find((r) => r.ref === t.ref);
      // somebody else has been at this tag since the book was read: it is theirs
      if (row && (row.state === 'paid' || (row.tries?.length ?? 0) !== tries.length)) return !(said.theirs = true);
      if (!tries.length) {
        const today = b.rows.filter((r) => r.ref !== t.ref && r.day === day && (r.state === 'paid' || r.state === 'sending'));
        const spent = today.reduce((s, r) => s + BigInt(r.lamports ?? 0), 0n);
        // the day's limit is a share of the most the treasury has been seen to hold that day: kept in
        // the book, so that everybody goes by the same figure whenever each of them happened to look
        if (b.most?.day !== day) b.most = { day, lamports: 0 };
        b.most.lamports = Math.max(b.most.lamports, Number(balance));
        const allowed = (BigInt(b.most.lamports) * BigInt(Math.round(cfg.dayShare * 1000))) / 1000n;
        if (today.filter((r) => r.wallet === t.wallet).length >= cfg.walletDayTags) said.wait = { state: 'waiting', why: `this wallet has been paid for ${cfg.walletDayTags} tags today: the rest wait for tomorrow`, hold: 'day' };
        // (the first of the day always goes: a limit smaller than one tag would stop everything)
        else if (today.length && spent + amount > allowed) said.wait = { state: 'waiting', why: "today's limit on what leaves the treasury has been reached: this one waits for tomorrow", hold: 'day' };
        if (said.wait) return row && says(row, said.wait, day) ? false : enter(b, t, said.wait, day);
      }
      enter(b, t, { state: 'sending', lamports: Number(amount), signature: attempt.signature }, day).tries = [...tries, attempt];
    },
    at.held,
  );
  if (said.theirs) {
    const theirs = at.held.book.rows.find((r) => r.ref === t.ref);
    return theirs ? told(theirs) : { state: 'waiting', why: 'being seen to' };
  }
  if (said.wait) return said.wait;

  // (a node that will not take it has not necessarily not passed it on: either way it is now an attempt, to be waited out)
  await w.rpc.send(tx).catch(refused('a payment'));
  if (await watch(w, tx)) return { state: 'paid', lamports: Number(amount), signature: attempt.signature, at: attempt.at, receipt: mine };
  return { state: 'sending', lamports: Number(amount), signature: attempt.signature };
}

// ------------------------------------------------------------------ the creator rewards

/** one collecting at a time in this process (two at once from two processes waste a fee and nothing else: the second finds nothing left) */
const collecting = new WeakMap<Store, number>();

/**
 * Collects the coin's creator rewards into the treasury, if enough are waiting.
 *
 * pump.fun pays a coin's creator rewards to the wallet that made the coin and to nobody
 * else, so this only does anything when the treasury is that wallet. The treasury signs and
 * pays the fee, as it would on pump.fun's own page.
 *
 * @param whatever true collects however little there is (the treasury is short now)
 * @returns what it did, in words
 */
export async function claim(w: World, whatever = false): Promise<string> {
  const cfg = w.cfg;
  if (cfg.mode !== 'on' || !cfg.key || !cfg.treasury) return 'payouts are not on';
  const treasury = cfg.treasury, key = cfg.key;
  const s = await (w.coin ?? coinState)(w.rpc, cfg.mint);
  if (s.unsupported || !s.creator) return `nothing to collect: ${s.unsupported ?? 'no creator'}`;
  if (!same(s.creator, treasury)) return `cannot be collected: the coin's rewards go to the wallet that made it (${b58(s.creator)}), and the key given is for a different wallet (${b58(treasury)})`;
  // (less than the fee a few times over is not worth sending for)
  const least = whatever ? 100_000n : cfg.claimAt;
  if (s.curve + s.pool < least) return `${sol(s.curve + s.pool)} SOL waiting: not enough to collect yet`;
  if (w.now() - (collecting.get(w.store) ?? -Infinity) < 90_000) return 'somebody else is collecting just now';
  collecting.set(w.store, w.now());

  const said: string[] = [];
  const collect = async (from: 'curve' | 'pool', ixs: Instruction[]) => {
    const todo = [computeLimit(CLAIM_UNITS), computePrice(cfg.bid), ...ixs, memo('ZONA creator rewards')];
    const before = await w.rpc.balance(treasury);
    const { blockhash } = await w.rpc.latestBlockhash();
    // tried first, unsigned: sent only if it would go through and would leave the treasury better off
    const sim = await w.rpc.simulate(unsigned(treasury, todo, blockhash), [treasury]);
    const after = sim.lamports[0];
    if (sim.err || after === null || after === undefined || after <= before) {
      said.push(`${from}: not sent (${sim.err ? 'it would fail: ' + JSON.stringify(sim.err) + ' ' + (sim.logs.at(-1) ?? '') : 'it would bring nothing in'})`);
      return;
    }
    const tx = signed(key, todo, blockhash);
    await w.rpc.send(tx).catch(refused('collecting rewards'));
    if (!(await watch(w, tx, 30_000))) {
      said.push(`${from}: sent, and not seen to arrive yet`);
      return;
    }
    // what it brought in is read off the transaction itself: nothing is counted that was not seen to arrive
    const got = (await w.rpc.gained(tx.signature, treasury).catch(() => null)) ?? after - before;
    if (got > 0n) {
      await editBook(w, (b) => {
        if (b.claims.some((c) => c.signature === tx.signature)) return false;
        b.claims.unshift({ at: iso(w.now()), signature: tx.signature, lamports: Number(got), from });
        b.claimedLamports += Number(got);
      });
    }
    said.push(`${from}: ${sol(got)} SOL collected`);
  };
  try {
    if (s.curve >= 100_000n) await collect('curve', claimCurve(treasury, cfg.mint, treasury));
    // (from PumpSwap they arrive as wrapped SOL: the account they arrive in is closed in the same breath, which makes them plain SOL)
    if (s.pool >= 100_000n && s.poolAccount && s.poolQuote) await collect('pool', [...claimPool(treasury, treasury, s.poolAccount, s.poolQuote), closeTokenAccount(tokenAccount(treasury, WRAPPED_SOL), treasury, treasury)]);
  } finally {
    collecting.delete(w.store);
    w.memo?.delete('coin');
    w.memo?.delete('balance');
  }
  return said.join('; ') || 'nothing worth collecting';
}

/**
 * Collects the rewards if enough are waiting. May be asked as often as anybody likes: once
 * they are collected there is nothing waiting, and a claim that would fail is never sent.
 */
export async function claimIfDue(w: World): Promise<string | null> {
  if (w.cfg.mode !== 'on') return null;
  let note: string;
  try {
    note = await claim(w);
  } catch (e) {
    return `could not: ${plain(e)}`;
  }
  if (/somebody else|not seen to arrive/.test(note)) return note;
  // only trouble that will not pass by itself is written down, and only when it changes: what
  // was collected is in the book already, and "not enough yet" is not news
  const trouble = /not sent|cannot be collected/.test(note) ? note.slice(0, 400) : '';
  if ((await glanceBook(w.store)).claimNote !== trouble) await editBook(w, (b) => (b.claimNote === trouble ? false : (b.claimNote = trouble) || true));
  return note;
}

// ------------------------------------------------------------------ one tag, start to finish

const settled = (r: Row) => r.state === 'paid' || r.state === 'skipped' || r.state === 'off';

/**
 * A tag in hand (from the game server, or from the book): paid if it is to be, and the book
 * says what became of it.
 * @param from the book as the caller has just read it; left holding the book as this wrote it
 */
export async function handleTag(w: World, t: Tag, from?: Held): Promise<Outcome> {
  const off = w.cfg.mode === 'off' || !w.cfg.treasury;
  if (!from) {
    // a look that costs nothing first: most asking is about tags whose answer will not change
    // (paid is paid), or cannot change yet (waiting for tomorrow)
    const seen = (await glanceBook(w.store)).rows.find((r) => r.ref === t.ref);
    if (seen && (settled(seen) || off || !(await due(w, seen)))) return told(seen);
  }
  const at = { held: from ?? (await freshBook(w.store)) };
  try {
    const had = at.held.book.rows.find((r) => r.ref === t.ref);
    // switched off, nothing already begun is touched: off is a stop, and what is in the book stays as it is
    if (had && (settled(had) || off)) return told(had);
    // (what was first written down of a tag is what holds, whatever is said of it later)
    if (had) t = { ref: had.ref, at: had.at, name: had.name, owner: had.owner, wallet: had.wallet };
    // payouts begin with what was cashed in over the ten minutes before they first run
    if (w.cfg.mode === 'on' && !at.held.book.since) at.held = await editBook(w, (b) => (b.since ? false : (b.since = iso(w.now() - 10 * 60_000))), at.held);
    let outcome: Outcome;
    let passing = false;
    try {
      outcome = await settle(w, t, at);
    } catch (err) {
      // not being able to ask is not a no: it is asked again, and whatever the book says of it meanwhile stands
      const now = at.held.book.rows.find((r) => r.ref === t.ref);
      if (now) return told(now);
      outcome = { state: 'waiting', why: `could not be done just now (${plain(err)})` };
      passing = true;
    }
    // written only when there is something new to say: the service counts every write
    const day = dayOf(w.now());
    at.held = await editBook(
      w,
      (b) => {
        const row = b.rows.find((r) => r.ref === t.ref);
        // (trouble that will pass is only written of a tag the book does not have yet: it changes nothing that is there)
        return row && (row.state === 'paid' || passing || says(row, outcome, day)) ? false : enter(b, t, outcome, day);
      },
      at.held,
    );
    return outcome;
  } finally {
    if (from) Object.assign(from, at.held);
  }
}

/** A tag has been cashed in (or is being asked about again by the game server). */
export const handle = (w: World, e: Entry) => handleTag(w, tagOf(e));

/** Collects the rewards if it is time, and goes back over the tags in the book that are not settled yet. */
export async function sweep(w: World, limit = 200): Promise<{ tried: number; paid: number; claim: string | null }> {
  // the rewards first: what they bring in is what the waiting tags are paid with
  const claimed = await claimIfDue(w).catch((e) => `could not: ${plain(e)}`);
  let tried = 0, paid = 0;
  if (w.cfg.mode !== 'off') {
    const waiting: Row[] = [];
    for (const r of (await glanceBook(w.store)).rows) if (open(r) && w.now() - Date.parse(r.at) < MAX_AGE_MS + 24 * 3600 * 1000 && (await due(w, r))) waiting.push(r);
    if (waiting.length) {
      const held = await freshBook(w.store);
      const began = w.now();
      // oldest first: whoever has waited longest. And not for longer than one request is allowed to take.
      for (const seen of waiting.reverse()) {
        if (tried >= limit || w.now() - began > 30_000) break;
        const r = held.book.rows.find((x) => x.ref === seen.ref);
        if (!r || !open(r)) continue;
        tried++;
        if ((await handleTag(w, r, held)).state === 'paid') paid++;
      }
    }
  }
  return { tried, paid, claim: claimed };
}

// ------------------------------------------------------------------ for the page

export interface Snapshot {
  mode: Config['mode'];
  /** why payouts are not on though they were asked for, or why they are on and pay nothing */
  problem: string | null;
  treasury: string | null;
  /** the treasury is the wallet that made the coin (so its creator rewards can be collected into it) */
  madeTheCoin: boolean;
  /** the wallet that made the coin, which is where its rewards go */
  maker: string | null;
  balance: number | null;
  /** what a tag cashed in now would pay */
  tagPays: number | null;
  share: number;
  floor: number;
  /** creator rewards not collected yet, or why there are none to collect */
  waiting: number | null;
  waitingNote: string | null;
  /** enough rewards are waiting to be collected now */
  due: boolean;
  dayShare: number;
  walletDayTags: number;
}

export async function snapshot(w: World): Promise<Snapshot> {
  const cfg = w.cfg;
  const out: Snapshot = { mode: cfg.mode, problem: cfg.problem, treasury: cfg.treasury ? b58(cfg.treasury) : null, madeTheCoin: false, maker: null, balance: null, tagPays: null, share: cfg.share, floor: Number(cfg.floor), waiting: null, waitingNote: null, due: false, dayShare: cfg.dayShare, walletDayTags: cfg.walletDayTags };
  try {
    const s = await coin(w);
    // with no key given yet, the treasury is taken to be the wallet that made the coin
    const treasury = cfg.treasury ?? s.creator;
    out.maker = s.creator ? b58(s.creator) : null;
    if (treasury) {
      out.treasury = b58(treasury);
      const balance = cfg.treasury ? await treasuryHolds(w) : await w.rpc.balance(treasury);
      out.balance = Number(balance);
      out.tagPays = Number(price(balance, cfg));
    }
    out.madeTheCoin = !!s.creator && !!treasury && same(s.creator, treasury);
    out.problem ??= await setup(w);
    if (s.unsupported) out.waitingNote = s.unsupported;
    else {
      out.waiting = Number(s.curve + s.pool);
      if (!out.madeTheCoin) out.waitingNote = 'they go to the wallet that made the coin, which is not the treasury: they cannot be collected into it';
      out.due = cfg.mode === 'on' && out.madeTheCoin && s.curve + s.pool >= cfg.claimAt;
    }
  } catch (e) {
    out.waitingNote = `the chain could not be read (${plain(e)})`;
  }
  return out;
}
