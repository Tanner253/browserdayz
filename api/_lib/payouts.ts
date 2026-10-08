// Paying for dog tags. A tag cashed in is paid out of the treasury (the wallet that made the
// coin on pump.fun) to the wallet the player gave; the treasury is kept topped up by
// collecting the coin's creator rewards; and every payment is written in a book the payouts
// page is drawn from, each with the transaction anybody can look up.
//
// What a tag pays: a share of what the treasury holds at that moment (two per cent unless
// set otherwise), and never less than a floor (0.02 SOL). A full treasury pays well; an
// empty one pays the floor until it cannot, and then tags wait for the next rewards.
//
// The one thing that must never happen is a tag paid twice. It cannot, for these reasons:
//
//   * Before a payment is sent, its signature (which is its name on the chain, known the
//     moment it is signed) is written to a file that can only be created once. Two workers
//     racing for the same tag: one creates the file, the other is told no and stands down.
//   * A second attempt is made only when every earlier one is provably dead: the chain has
//     moved past the last block in which it could have been included (counting only blocks
//     that cannot be undone, and a margin on top), and the same node that says so has no
//     record of it. The earlier ones are looked for once more before the new one is signed.
//     A payment that might still arrive is waited for, however long the wait.
//   * The amount and the wallet are fixed by the first attempt. Later ones pay the same.
//
// The book is for reading, limits and totals. If it were lost it could be rebuilt; no
// payment decision rests on it alone.

import { createHash } from 'node:crypto';
import { Keypair, LAMPORTS, SYSTEM_PROGRAM, address, b58, computeLimit, computePrice, memo, onCurve, same, signed, transfer, unsigned, type Bytes, type Rpc, type Signed } from './solana.js';
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
  try {
    if (env.PUMP_MINT) mint = address(env.PUMP_MINT.trim());
    if (env.TREASURY_ADDRESS) treasury = address(env.TREASURY_ADDRESS.trim());
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
  }
  const floor = lamports(num(env.TAG_PAY_MIN_SOL, 0.02, 0.001, 10));
  return {
    mode,
    problem,
    key,
    treasury,
    rpc: env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC,
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

export type Outcome =
  | { state: 'paid'; lamports: number; signature: string; at: string }
  /** sent and not seen to arrive yet */
  | { state: 'sending'; lamports: number; signature: string }
  /** will be paid when it can be: nothing more is needed from the player */
  | { state: 'waiting'; why: string }
  /** will not be paid, and why */
  | { state: 'skipped'; why: string }
  /** payouts are not switched on: listed only */
  | { state: 'off' };

/** one attempt at one payment: written before the transaction is sent, never changed */
interface Try {
  n: number;
  id: string;
  wallet: string;
  lamports: number;
  signature: string;
  /** the last block in which it can be included */
  lastValidBlockHeight: number;
  /** the signed transaction itself: sending it again is the same payment, not a second one */
  wire: string;
  at: string;
  nonce: string;
}

/**
 * What a payment carries on the chain to say which tag it is for, and what the page shows
 * beside that tag: made from the tag's id, and not the id itself (the id is what the game
 * server calls this site with, and is not given out).
 */
export const refOf = (id: string) => createHash('sha256').update(`ZONA dog tag ${id}`).digest('hex').slice(0, 12);

export interface Row extends Entry {
  ref?: string;
  state: Outcome['state'];
  why?: string;
  lamports?: number;
  signature?: string;
  paidAt?: string;
  /** the day (UTC) the payment was sent: what the day's limits count */
  day?: string;
}

export interface Claim {
  at: string;
  signature: string;
  /** what it brought in, less its fee */
  lamports: number;
  from: 'curve' | 'pool';
  /** seen to arrive */
  done: boolean;
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
}

const BOOK = 'ledger/book.json';
const ROWS_KEPT = 500;
const tryPath = (id: string, n: number) => `ledger/try/${id}/${n}.json`;
const emptyBook = (): Book => ({ v: 1, since: null, rows: [], tags: 0, paid: 0, paidLamports: 0, claims: [], claimedLamports: 0, claimNote: '' });

export async function readBook(store: Store): Promise<Book> {
  return (await store.read<Book>(BOOK))?.data ?? emptyBook();
}

/**
 * Changes the book, starting again from the latest copy if somebody else changed it meanwhile
 * (after a short wait of no fixed length, so that several who collide do not collide again).
 */
export async function editBook(w: Pick<World, 'store' | 'sleep' | 'random'>, change: (book: Book) => void): Promise<Book> {
  for (let i = 0; i < 25; i++) {
    const had = await w.store.read<Book>(BOOK);
    const book = had?.data ?? emptyBook();
    change(book);
    book.rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    // the latest are kept, and with them every older one that is not settled yet: a tag still owed is never dropped
    if (book.rows.length > ROWS_KEPT) book.rows = [...book.rows.slice(0, ROWS_KEPT), ...book.rows.slice(ROWS_KEPT).filter((r) => r.state === 'sending' || r.state === 'waiting')];
    book.claims.length = Math.min(book.claims.length, 100);
    if (await w.store.swap(BOOK, book, had?.mark ?? null)) return book;
    await w.sleep(20 + w.random() * 150 * Math.min(i + 1, 6));
  }
  throw new Error('the book could not be written');
}

/** Puts a tag and what became of it in the book (a tag already down as paid stays as it is). */
export function enter(book: Book, e: Entry, o: Outcome, day: string) {
  let row = book.rows.find((r) => r.id === e.id);
  if (!row) {
    row = { id: e.id, ref: refOf(e.id), at: e.at, name: e.name, owner: e.owner, wallet: e.wallet, state: 'off' };
    book.rows.push(row);
    book.tags++;
  }
  if (row.state === 'paid') return;
  row.state = o.state;
  row.why = 'why' in o ? o.why : undefined;
  if (o.state === 'paid' || o.state === 'sending') {
    row.lamports = o.lamports;
    row.signature = o.signature;
    row.day ??= day;
  } else row.signature = undefined;
  if (o.state === 'paid') {
    row.paidAt = o.at;
    book.paid++;
    book.paidLamports += o.lamports;
  }
}

// ------------------------------------------------------------------ the world it runs in

/** the questions asked of the chain (the real thing is Rpc; the tests bring their own) */
export type Chain = Pick<Rpc, 'balance' | 'latestBlockhash' | 'blockHeight' | 'send' | 'statuses' | 'simulate' | 'account' | 'tokenBalance'> & { steady(): Promise<Pick<Rpc, 'blockHeight' | 'statuses'>> };

export interface World {
  cfg: Config;
  rpc: Chain;
  store: Store;
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  /** where the coin's rewards stand (pump.ts, unless a test says otherwise) */
  coin?: (rpc: Chain, mint: Bytes) => Promise<CoinState>;
}

const iso = (ms: number) => new Date(ms).toISOString();
export const dayOf = (ms: number) => iso(ms).slice(0, 10);

/** a tag older than this is not paid by the machine any more */
const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
const MAX_TRIES = 5;
/** blocks past a transaction's last chance before it is called dead, on top of only counting blocks that cannot be undone */
const DEAD_MARGIN = 20;
/** how long one request waits to see its payment arrive (a claim and a payment in one request must both fit in the minute a request is allowed) */
const WATCH_MS = 18_000;
/** the fee, with room to spare: a payment is only begun if this is there as well */
const FEE_ROOM = 20_000n;
/** work allowed: a transfer with a note on it uses a few thousand units; a claim, about sixty thousand */
const PAY_UNITS = 40_000;
const CLAIM_UNITS = 250_000;

const landed = (s: { err: unknown; confirmationStatus: string | null } | null) => !!s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized');

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

// ------------------------------------------------------------------ paying one tag

/**
 * Pays a tag, or says why not, or finds that it has been paid already. Safe to call again
 * and again for the same tag, and from two places at once.
 */
export async function settle(w: World, e: Entry, book: Book): Promise<Outcome> {
  const cfg = w.cfg;
  if (cfg.mode === 'off' || !cfg.treasury) return { state: 'off' };
  const now = w.now();

  if (!e.wallet) return { state: 'skipped', why: 'no wallet given' };
  let to: Bytes;
  try {
    to = address(e.wallet);
  } catch {
    return { state: 'skipped', why: 'not a wallet address' };
  }
  if (same(to, cfg.treasury)) return { state: 'skipped', why: 'not a wallet that can be paid' };

  // --- what has been tried already
  const tries: Try[] = [];
  for (let n = 1; n <= MAX_TRIES; n++) {
    const t = await w.store.read<Try>(tryPath(e.id, n));
    if (!t) break;
    tries.push(t.data);
  }
  if (tries.length) {
    // (how far the chain has got is asked first, then what it has seen: an answer of "never
    // seen" given after "well past its last chance" is final)
    const node = await w.rpc.steady();
    const height = await node.blockHeight();
    const seen = await node.statuses(tries.map((t) => t.signature));
    const hit = tries.findIndex((_, i) => landed(seen[i]));
    if (hit >= 0) return { state: 'paid', lamports: tries[hit].lamports, signature: tries[hit].signature, at: tries[hit].at };
    const dead = (t: Try, i: number) => (seen[i] ? !!seen[i]!.err && seen[i]!.confirmationStatus === 'finalized' : height > t.lastValidBlockHeight + DEAD_MARGIN);
    const alive = tries.filter((t, i) => !dead(t, i));
    if (alive.length) {
      const last = alive[alive.length - 1];
      // the very same transaction once more does no harm and may help it along
      await w.rpc.send({ wire: Uint8Array.from(Buffer.from(last.wire, 'base64')), signature: last.signature }).catch(() => {});
      return { state: 'sending', lamports: last.lamports, signature: last.signature };
    }
    if (tries.length >= MAX_TRIES) return { state: 'waiting', why: `${MAX_TRIES} attempts did not go through: this one needs looking at` };
    // what the first attempt set out to do is what every later one does
    to = address(tries[0].wallet);
  }

  // --- whether it is to be paid at all (asked afresh each time until a first attempt exists)
  if (!tries.length) {
    if (!(now - Date.parse(e.at) < MAX_AGE_MS)) return { state: 'skipped', why: 'cashed in more than three days ago' };
    if (book.since && Date.parse(e.at) < Date.parse(book.since)) return { state: 'skipped', why: 'cashed in before automatic payouts began' };
    const there = await w.rpc.account(to);
    if (there && !same(there.owner, SYSTEM_PROGRAM)) return { state: 'skipped', why: 'that address is not a wallet (it belongs to a program)' };
    // an address nobody can hold the key to, and that has never been used: money sent there is gone
    if (!there && !onCurve(to)) return { state: 'skipped', why: 'that address is not a wallet anybody holds the key to' };
  }

  // --- how much, and whether the treasury and the day's limits allow it
  let balance = await w.rpc.balance(cfg.treasury);
  const amount = tries.length ? BigInt(tries[0].lamports) : price(balance, cfg);
  if (!tries.length) {
    const today = book.rows.filter((r) => r.id !== e.id && r.day === dayOf(now) && (r.state === 'paid' || r.state === 'sending'));
    if (today.filter((r) => r.wallet === e.wallet).length >= cfg.walletDayTags) return { state: 'waiting', why: `this wallet has been paid for ${cfg.walletDayTags} tags today: the rest are paid tomorrow` };
    const spent = today.reduce((s, r) => s + BigInt(r.lamports ?? 0), 0n);
    const allowed = ((balance + spent) * BigInt(Math.round(cfg.dayShare * 1000))) / 1000n;
    // (the first of the day always goes: a limit smaller than one tag would stop everything)
    if (today.length && spent + amount > allowed) return { state: 'waiting', why: "today's limit on what leaves the treasury has been reached: paid tomorrow" };
  }
  const short = () => balance < amount + FEE_ROOM + cfg.keep;
  if (short() && cfg.mode === 'on') {
    // bring the rewards home first, whatever there is of them
    await claim(w, true).catch(() => {});
    balance = await w.rpc.balance(cfg.treasury);
  }
  if (short()) return { state: 'waiting', why: 'the treasury is too low: paid when the next creator rewards come in' };

  // --- a dry run stops here: the payment is put together and tried on a node, and not sent
  const { blockhash, lastValidBlockHeight } = await w.rpc.latestBlockhash();
  const todo = [computeLimit(PAY_UNITS), computePrice(cfg.bid), transfer(cfg.treasury, to, amount), memo(`ZONA dog tag ${refOf(e.id)}`)];
  if (cfg.mode === 'dry' || !cfg.key) {
    const sim = await w.rpc.simulate(unsigned(cfg.treasury, todo, blockhash));
    return { state: 'waiting', why: `dry run: would pay ${sol(amount)} SOL (${sim.err ? 'and it would FAIL: ' + JSON.stringify(sim.err) : 'tried, and it would go through'})` };
  }

  // --- another attempt is about to be made: one more look, at whichever node answers, for the earlier ones
  if (tries.length) {
    const again = await w.rpc.statuses(tries.map((t) => t.signature));
    const hit = tries.findIndex((_, i) => landed(again[i]));
    if (hit >= 0) return { state: 'paid', lamports: tries[hit].lamports, signature: tries[hit].signature, at: tries[hit].at };
    const i = again.findIndex((a) => a && !a.err);
    if (i >= 0) return { state: 'sending', lamports: tries[i].lamports, signature: tries[i].signature };
  }

  // --- sign it, write its name down where only one can be written, and only then send it
  const tx = signed(cfg.key, todo, blockhash);
  const mine: Try = { n: tries.length + 1, id: e.id, wallet: e.wallet, lamports: Number(amount), signature: tx.signature, lastValidBlockHeight, wire: Buffer.from(tx.wire).toString('base64'), at: iso(now), nonce: `${now}-${Math.floor(w.random() * 1e12)}` };
  const theirs = async (): Promise<Outcome> => {
    const t = (await w.store.read<Try>(tryPath(e.id, mine.n)))?.data;
    return t ? { state: 'sending', lamports: t.lamports, signature: t.signature } : { state: 'waiting', why: 'another attempt is under way' };
  };
  if (!(await w.store.create(tryPath(e.id, mine.n), mine))) return theirs();
  // (and look again after a moment: if two were somehow both told yes, both now read the same file, and only its author goes on)
  await w.sleep(250 + w.random() * 500);
  if ((await w.store.read<Try>(tryPath(e.id, mine.n)))?.data.nonce !== mine.nonce) return theirs();

  // (a node that will not take it has not necessarily not passed it on: either way it is now an attempt, to be waited out)
  await w.rpc.send(tx).catch(() => {});
  if (await watch(w, tx)) return { state: 'paid', lamports: mine.lamports, signature: mine.signature, at: mine.at };
  return { state: 'sending', lamports: mine.lamports, signature: mine.signature };
}

// ------------------------------------------------------------------ the creator rewards

/**
 * Collects the coin's creator rewards into the treasury, if enough are waiting.
 * @param whatever true collects however little there is (the treasury is short now)
 * @returns what it did, in words
 */
export async function claim(w: World, whatever = false): Promise<string> {
  const cfg = w.cfg;
  if (cfg.mode !== 'on' || !cfg.key || !cfg.treasury) return 'payouts are not on';
  const treasury = cfg.treasury;
  const s = await (w.coin ?? coinState)(w.rpc, cfg.mint);
  if (s.unsupported || !s.creator) return `nothing to collect: ${s.unsupported ?? 'no creator'}`;
  if (!same(s.creator, treasury)) return `the treasury (${b58(treasury)}) is not the wallet that made the coin (${b58(s.creator)}): its rewards cannot be collected with this key`;
  // (less than the fee a few times over is not worth sending for)
  const least = whatever ? 100_000n : cfg.claimAt;
  if (s.curve + s.pool < least) return `${sol(s.curve + s.pool)} SOL waiting: not enough to collect yet`;

  const sides: { from: 'curve' | 'pool'; waiting: bigint; ixs: ReturnType<typeof claimCurve> }[] = [];
  if (s.curve >= 100_000n) sides.push({ from: 'curve', waiting: s.curve, ixs: claimCurve(treasury, cfg.mint, treasury) });
  if (s.pool >= 100_000n && s.poolAccount && s.poolQuote) sides.push({ from: 'pool', waiting: s.pool, ixs: claimPool(treasury, s.poolAccount, s.poolQuote) });
  const said: string[] = [];
  for (const side of sides) {
    const todo = [computeLimit(CLAIM_UNITS), computePrice(cfg.bid), ...side.ixs, memo('ZONA creator rewards')];
    const before = await w.rpc.balance(treasury);
    const { blockhash } = await w.rpc.latestBlockhash();
    // tried first, unsigned: sent only if it would go through and would leave the treasury better off
    const sim = await w.rpc.simulate(unsigned(treasury, todo, blockhash), [treasury]);
    const after = sim.lamports[0];
    if (sim.err || after === null || after === undefined || after <= before) {
      said.push(`${side.from}: not sent (${sim.err ? 'it would fail: ' + JSON.stringify(sim.err) + ' ' + (sim.logs.at(-1) ?? '') : 'it would bring nothing in'})`);
      continue;
    }
    const tx = signed(cfg.key, todo, blockhash);
    await w.rpc.send(tx).catch(() => {});
    const done = await watch(w, tx);
    const got = Number(after - before);
    await editBook(w, (b) => {
      b.claims.unshift({ at: iso(w.now()), signature: tx.signature, lamports: got, from: side.from, done });
      b.claimedLamports += got;
    });
    said.push(`${side.from}: ${sol(got)} SOL ${done ? 'collected' : 'sent for'}`);
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
    note = `could not: ${(e as Error).message.slice(0, 160)}`;
  }
  // only trouble is written down, and only when it changes: what was collected is in the
  // book already, and "not enough yet" is not news
  const trouble = /not sent|could not|cannot be collected/.test(note) ? note : '';
  if ((await readBook(w.store)).claimNote !== trouble) await editBook(w, (b) => (b.claimNote = trouble));
  return note;
}

// ------------------------------------------------------------------ one tag, start to finish

/**
 * A tag has been cashed in (or is being asked about again): it goes in the book, is paid
 * if it is to be, and the book says what became of it.
 */
export async function handle(w: World, e: Entry): Promise<Outcome> {
  let book = await readBook(w.store);
  const had = book.rows.find((r) => r.id === e.id);
  // (paid is paid: nothing more to ask of anybody)
  if (had?.state === 'paid') return { state: 'paid', lamports: had.lamports ?? 0, signature: had.signature ?? '', at: had.paidAt ?? had.at };
  if (w.cfg.mode === 'on' && !book.since) {
    // payouts begin with the tag that is in hand, if it has only just been cashed in: it
    // was cashed in a moment before this ran, and must not count as "before"
    const fresh = w.now() - Date.parse(e.at) < 15 * 60_000;
    book = await editBook(w, (b) => (b.since ??= fresh ? e.at : iso(w.now())));
  }
  let outcome: Outcome;
  try {
    outcome = await settle(w, e, book);
  } catch (err) {
    // (not being able to ask is not a no: it is asked again)
    outcome = { state: 'waiting', why: `could not be done just now (${(err as Error).message.slice(0, 120)})` };
  }
  // written only when there is something new to say: the service counts every write
  const same_ = had && had.state === outcome.state && had.why === ('why' in outcome ? outcome.why : undefined) && had.signature === ('signature' in outcome ? outcome.signature : undefined);
  if (!same_) await editBook(w, (b) => enter(b, e, outcome, dayOf(w.now())));
  return outcome;
}

/** Goes back over the tags in the book that are not settled yet (and collects rewards if it is time). */
export async function sweep(w: World, limit = 20): Promise<{ tried: number; paid: number; claim: string | null }> {
  const book = await readBook(w.store);
  const open = book.rows.filter((r) => (r.state === 'sending' || r.state === 'waiting' || r.state === 'off') && w.now() - Date.parse(r.at) < MAX_AGE_MS + 24 * 3600 * 1000);
  let tried = 0, paid = 0;
  if (w.cfg.mode !== 'off') {
    const began = w.now();
    // oldest first: whoever has waited longest. And not for longer than one request is allowed to take.
    for (const r of open.reverse()) {
      if (tried >= limit || w.now() - began > 30_000) break;
      tried++;
      if ((await handle(w, r)).state === 'paid') paid++;
    }
  }
  return { tried, paid, claim: await claimIfDue(w).catch((e) => `could not: ${(e as Error).message}`) };
}

// ------------------------------------------------------------------ for the page

export interface Snapshot {
  mode: Config['mode'];
  problem: string | null;
  treasury: string | null;
  /** the treasury is the wallet that made the coin (so its creator rewards can be collected into it) */
  madeTheCoin: boolean;
  balance: number | null;
  /** what a tag cashed in now would pay */
  tagPays: number | null;
  share: number;
  floor: number;
  /** creator rewards not collected yet, or why there are none to collect */
  waiting: number | null;
  waitingNote: string | null;
  dayShare: number;
  walletDayTags: number;
}

export async function snapshot(w: World): Promise<Snapshot> {
  const cfg = w.cfg;
  const out: Snapshot = { mode: cfg.mode, problem: cfg.problem, treasury: cfg.treasury ? b58(cfg.treasury) : null, madeTheCoin: false, balance: null, tagPays: null, share: cfg.share, floor: Number(cfg.floor), waiting: null, waitingNote: null, dayShare: cfg.dayShare, walletDayTags: cfg.walletDayTags };
  try {
    const s = await (w.coin ?? coinState)(w.rpc, cfg.mint);
    // with no key given yet, the treasury is taken to be the wallet that made the coin
    const treasury = cfg.treasury ?? s.creator;
    if (treasury) {
      out.treasury = b58(treasury);
      const balance = await w.rpc.balance(treasury);
      out.balance = Number(balance);
      out.tagPays = Number(price(balance, cfg));
    }
    out.madeTheCoin = !!s.creator && !!treasury && same(s.creator, treasury);
    if (s.unsupported) out.waitingNote = s.unsupported;
    else if (s.creator && treasury && !same(s.creator, treasury)) out.waitingNote = 'the treasury is not the wallet that made the coin';
    else out.waiting = Number(s.curve + s.pool);
  } catch (e) {
    out.waitingNote = `the chain could not be read (${(e as Error).message.slice(0, 80)})`;
  }
  return out;
}
