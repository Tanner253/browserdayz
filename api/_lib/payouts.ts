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
// That is how it was. From the second cut-over (RULES2_FROM, below) a tag pays the floor, flat,
// whatever the treasury holds, and a wallet is paid only when five of its tags are due: all of
// them in one transaction, which still makes a receipt for each. What was cashed in before
// the cut-over and has not been paid by then is not paid: the old book is closed at that
// moment, and those tags are taken out of it (see `closed`).
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
import { EMPTY_ACCOUNT_RENT, Keypair, LAMPORTS, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WRAPPED_SOL, address, b58, closeTokenAccount, computeLimit, computePrice, memo, onCurve, receipt, same, seeded, signed, tokenAccount, transfer, unsigned, type Bytes, type Instruction, type Rpc, type Signed, type Status } from './solana.js';
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
  /**
   * The rules of 2026-10-13 hold for whatever is cashed in from this moment on (ms). The treasury was paying out
   * half as much again as came in, and the owner chose three things, all of them: the limit of a wallet's tags in
   * a day is a limit and not a queue (a tag over it is not paid: it used to wait and be paid on the days after);
   * two players who cash each other's tags inside a day are paid for the first of the two and not the second; and
   * a tag pays 0.01 SOL at least, where it paid 0.02. What was cashed in before this is paid as it was promised:
   * it waits its turn, and is paid at the old least.
   */
  rulesFrom: number;
  /** what a tag cashed in before `rulesFrom` pays at least */
  floorBefore: bigint;
  /**
   * The second cut-over (ms): the owner, 2026-10-13, "we will pay .01 per tag now, but we wont pay out till the user
   * is due for 5 tags". For whatever is cashed in from this moment on, a tag pays `floor` and no more (the share of
   * the treasury is not asked at all, so nothing set for it can make a full treasury pay more), and a wallet is paid
   * only when `minTags` of its tags are due: see `dueOf`. What was cashed in before it and is not paid when it comes
   * is not paid, and is taken out of the book: see `closed`.
   * Which rules a tag is under is written on it when it is first put in the book (`rules` on its row), and holds
   * from then on: moving this moment never changes what a tag already in the book was promised.
   * Infinity: no moment is set for it (see RULES2_FROM), and there is no second cut-over.
   *
   * THE WAY BACK. If the moment is taken away again after it has come (`PAYOUT_RULES2_FROM=never`), or moved to
   * one that has not come yet, the rule is put off: what is cashed in from then on is paid as it was before the
   * cut-over, and what the book already holds under the rule is paid out as it stands, at what it was promised
   * (`floor` a tag), without waiting to be five: all of a wallet's that are due together, whether that is one or
   * nine. See `needOf`. (It used to be that such tags then waited for good, four of five for ever.)
   */
  rules2From: number;
  /** from `rules2From`: a wallet is paid when this many of its tags are due, and not before (1: each as it comes) */
  minTags: number;
  /**
   * The third cut-over (ms), the owner, 2026-10-14: "i thought we did the 5/5 system now ... only 1 5/5 payout per 24
   * hours too as a safegaurd". Three a UTC day had left nobody able to come to five in one. For a tag cashed in from
   * this moment on, the limit is `walletTags24` of a wallet's cashed in any 24 hours (UTC days no longer come into
   * it): one lot of five, and so one payment of five, in a day. One over it is not paid, as over the three was not.
   * What was cashed in before is judged as it was (`walletDayTags` a UTC day). See `overDay`.
   */
  rules3From: number;
  walletTags24: number;
  /**
   * The fourth cut-over (ms), the owner, 2026-10-15: "the current payout system is tooo.. limitiing ... a player can
   * cash out 5 tags every 12 hours / all 5 tags are cashed at once when 5/5 is achieved". For a tag cashed in from
   * this moment on, the `walletTags24` are counted over the 12 hours before it, not the 24: one payment of five every
   * 12 hours. Still a limit, not a queue. What was cashed in before is judged as it was. See `windowOf`.
   */
  rules4From: number;
  /**
   * The fifth cut-over (ms), the owner, 2026-10-15: "we should increase the amount we payout per tag based on the amount
   * of supply in the users wallet ... maybe you could come up with a more realistic ratio" and "the max cap for a player
   * per tag should be .025 sol". For a tag cashed in from this moment on, under the rule of five, it pays `holderPerM`
   * more for every million of the coin its wallet holds, up to `tagMax` the tag in all. What counts is the lower of
   * what the wallet held when the tag was cashed in (`held`, written then) and when it is paid: coins lent to it for a
   * moment, or passed from one player's wallet to another's, count for nothing. See `holderBonus`.
   */
  rules5From: number;
  /** lamports more a tag, for every million whole coins held (0.001 SOL) */
  holderPerM: bigint;
  /** the most a tag pays, with what is added for holding (0.025 SOL) */
  tagMax: bigint;
  /**
   * The sixth cut-over (ms), the owner, 2026-10-18, the treasury paying out too much with more players on: "the first 10
   * tags are free to play play to earn but after that we make the user have a token holder requirement to even be
   * ELIGBLE to get payouts ... 10 tags covers 150k supply", and then "100k supply instead of 150". For a tag cashed in from this moment on, once its wallet or
   * its player has had `freeTags` paid, it is paid only if the wallet holds `holdMin` of the coin, the lower of then and
   * now as for the holder bonus; otherwise it is not paid. See `pastFree`.
   */
  rules6From: number;
  freeTags: number;
  /** what of the coin a wallet must hold past its free tags, in its smallest unit (100,000 whole coins) */
  holdMin: bigint;
  /**
   * The seventh cut-over (ms), the owner, 2026-10-19, players who held the coin unpaid ("people wiaitng for payouts
   * currently on /payouts complain they have 100k supply on the wallet but dont get pay": they had bought it after
   * cashing in), asked whether such a tag should wait: "12 hour". From this moment a tag past its free ones whose wallet
   * holds less than `holdMin` is not refused: it waits (`coin`), judged by what the wallet holds each time it is looked
   * at, and is paid as soon as it holds enough, for `holdWait` after it was cashed in; then it is not paid. One refused
   * for it within `holdWait` before this moment waits too (see `reopen`).
   */
  rules7From: number;
  holdWait: number;
  /** rewards are collected when at least this much is waiting */
  claimAt: bigint;
  /** what is bid per unit of work, in millionths of a lamport: enough to be taken up promptly */
  bid: number;
}

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const DEFAULT_MINT = 'GvfAzdPF466PJsPJMzXQeX3TSqmJm9YxAG8xBJ6ypump';
/**
 * THE MOMENT OF THE SECOND CUT-OVER, in UTC, written like '2026-10-14T18:00:00Z': a tag cashed in from that moment
 * on pays 0.01 SOL flat, and its wallet is paid when five are due; and every tag cashed in before it that has not
 * been paid by then is taken out of the book and never paid (see `closed`). TO BE SET BY WHOEVER DEPLOYS THIS, here (or as
 * PAYOUT_RULES2_FROM, which is asked first), to a moment at or after the deploy: the payouts page says this moment
 * to everybody, before it comes and after.
 *
 * While it is '' (or anything that is not a moment) there is no second cut-over: every tag is paid as it was before,
 * and nothing anywhere says otherwise, however and whenever this code is deployed. The change was the owner's to
 * begin, and the owner began it on 2026-10-13: "i want to cancel all current pending payouts and move forward
 * wihtour new payout tracking system", and then "deploy the payout change with the next build". So it is written
 * below AT THAT BUILD, as a moment about a quarter of an hour after the deploy, and is '' until then.
 *
 * It must be written in full, with its zone: '2026-10-14T18:00:00Z' or '2026-10-14T20:00:00+02:00'. Anything else
 * (a day without its hour, an hour without its zone) is no moment, and nothing begins: see `config`.
 * To go back after it has begun, nothing here is touched: PAYOUT_RULES2_FROM=never puts the rule off, and what is
 * owed under it is then paid out as it stands (see `rules2From` in Config, and `needOf`).
 */
export const RULES2_FROM = '2026-10-14T02:20:00Z';
/** The moment of the third cut-over (see `rules3From`), written as RULES2_FROM is; PAYOUT_RULES3_FROM is asked first. */
export const RULES3_FROM = '2026-10-14T22:00:00Z';
/** The moment of the fifth (see `rules5From`), written as RULES2_FROM is; PAYOUT_RULES5_FROM is asked first. '': none yet. */
export const RULES5_FROM = '2026-10-15T17:45:00Z';
/** the coin's decimals: pump.fun's are six */
const COIN_DECIMALS = 6n;
/** The moment of the fourth (see `rules4From`), written as RULES2_FROM is; PAYOUT_RULES4_FROM is asked first. '': none yet. */
export const RULES4_FROM = '2026-10-15T17:30:00Z';
/** The moment of the sixth (see `rules6From`), written as RULES2_FROM is; PAYOUT_RULES6_FROM is asked first. '': none yet. */
export const RULES6_FROM = '2026-10-19T01:15:00Z';
/** The moment of the seventh (see `rules7From`), written as RULES2_FROM is; PAYOUT_RULES7_FROM is asked first. '': none yet. */
export const RULES7_FROM = '2026-10-19T04:00:00Z';
/** a moment written in full, a day, a time and a zone (see `config`) */
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

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
  const floor = lamports(num(env.TAG_PAY_MIN_SOL, 0.01, 0.001, 10));
  const from = Date.parse(env.PAYOUT_RULES_FROM ?? '');
  const rulesFrom = Number.isFinite(from) ? from : Date.parse('2026-10-13T04:30:00Z');
  // (what is set outside is asked first, and "never" there holds it off whatever is written here; then RULES2_FROM.
  // It must be a moment written in full, a day, a time and a zone: `Date.parse` takes "1" for the first of January
  // 2001 and "2026" for the first of this year, and either typed by mistake would have begun the new rules at once,
  // for every tag since the rules of 2026-10-13. Anything else is no moment, and nothing begins.)
  const said2 = (env.PAYOUT_RULES2_FROM?.trim() ? env.PAYOUT_RULES2_FROM : RULES2_FROM).trim();
  const from2 = MOMENT.test(said2) ? Date.parse(said2) : NaN;
  const said3 = (env.PAYOUT_RULES3_FROM?.trim() ? env.PAYOUT_RULES3_FROM : RULES3_FROM).trim();
  const from3 = MOMENT.test(said3) ? Date.parse(said3) : NaN;
  const said4 = (env.PAYOUT_RULES4_FROM?.trim() ? env.PAYOUT_RULES4_FROM : RULES4_FROM).trim();
  const from4 = MOMENT.test(said4) ? Date.parse(said4) : NaN;
  const said5 = (env.PAYOUT_RULES5_FROM?.trim() ? env.PAYOUT_RULES5_FROM : RULES5_FROM).trim();
  const from5 = MOMENT.test(said5) ? Date.parse(said5) : NaN;
  const said6 = (env.PAYOUT_RULES6_FROM?.trim() ? env.PAYOUT_RULES6_FROM : RULES6_FROM).trim();
  const from6 = MOMENT.test(said6) ? Date.parse(said6) : NaN;
  const said7 = (env.PAYOUT_RULES7_FROM?.trim() ? env.PAYOUT_RULES7_FROM : RULES7_FROM).trim();
  const from7 = MOMENT.test(said7) ? Date.parse(said7) : NaN;
  // (each tag paid as it comes, as before the rule of five: the owner, 2026-10-15, "players no longer need to get 5 tags to
  // cash out, we will go back to cahsing them out isntantly if theres fund in streasury". It was five. Everything else of
  // the later rules holds: the holder bonus and its tiers, the five a wallet in twelve hours. What waits for a fifth in
  // the book is due from now, and paid at the next look: see `needOf`.)
  const minTags = Math.round(num(env.PAYOUT_MIN_TAGS, 1, 1, 100));
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
    dayShare: num(env.PAYOUT_DAY_CAP_PERCENT, 75, 1, 100) / 100,
    walletDayTags: Math.round(num(env.PAYOUT_WALLET_DAY_TAGS, 3, 1, 1000)),
    rulesFrom,
    floorBefore: lamports(num(env.TAG_PAY_MIN_SOL_BEFORE, 0.02, 0.001, 10)),
    // (not set: never. And never before the rules of 2026-10-13, which it is built on.)
    rules2From: Number.isFinite(from2) ? Math.max(rulesFrom, from2) : Infinity,
    minTags,
    // (never before the rules of 2026-10-13, whose limit it changes)
    rules3From: Number.isFinite(from3) ? Math.max(rulesFrom, from3) : Infinity,
    // (one lot: what is set outside for the old limit, if anything, holds for this one too)
    // (five a wallet, whatever a payout is made of: the owner, 2026-10-15, "players can cash 5 tags a day instead of just
    // 3 now". It was the size of a payout, five, and would have gone down to one with it.)
    walletTags24: Math.round(num(env.PAYOUT_WALLET_DAY_TAGS, 5, 1, 1000)),
    // (never before the third, whose window it shortens)
    rules4From: Number.isFinite(from4) && Number.isFinite(from3) ? Math.max(rulesFrom, from3, from4) : Infinity,
    // (never before the rule of five, whose flat pay it adds to)
    rules5From: Number.isFinite(from5) && Number.isFinite(from2) ? Math.max(rulesFrom, from2, from5) : Infinity,
    holderPerM: lamports(num(env.PAYOUT_HOLDER_SOL_PER_M, 0.001, 0, 1)),
    tagMax: lamports(num(env.TAG_PAY_MAX_HOLDER_SOL, 0.025, 0.001, 1)),
    rules6From: Number.isFinite(from6) ? Math.max(rulesFrom, from6) : Infinity,
    freeTags: Math.round(num(env.PAYOUT_FREE_TAGS, 10, 0, 1000)),
    holdMin: BigInt(Math.round(num(env.PAYOUT_HOLD_MIN, 100_000, 0, 1e12))) * 10n ** COIN_DECIMALS,
    // (never before the sixth, whose refusals it turns into a wait)
    rules7From: Number.isFinite(from7) && Number.isFinite(from6) ? Math.max(rulesFrom, from6, from7) : Infinity,
    holdWait: num(env.PAYOUT_HOLD_WAIT_H, 12, 0, 72) * 3600_000,
    claimAt: lamports(num(env.CLAIM_MIN_SOL, 0.05, 0.001, 1000)),
    bid: Math.round(num(env.PRIORITY_MICROLAMPORTS, 20_000, 0, 5_000_000)),
  };
}

/**
 * The settings a tag is paid by: one cashed in before the rules of 2026-10-13 is paid at the least it was promised,
 * and one under the rules of the second cut-over is paid the floor and nothing else, whatever the treasury holds.
 * @param five the tag is under the rules of the second cut-over (as its row in the book says, once it has one)
 */
export function termsOf(cfg: Config, cashedAt: string, five = Date.parse(cashedAt) >= cfg.rules2From): Config {
  if (five) return { ...cfg, share: 0, ceiling: cfg.floor };
  if (!(Date.parse(cashedAt) < cfg.rulesFrom) || cfg.floorBefore <= cfg.floor) return cfg;
  return { ...cfg, floor: cfg.floorBefore, ceiling: cfg.ceiling > cfg.floorBefore ? cfg.ceiling : cfg.floorBefore };
}

/** What one tag pays out of a treasury holding this much. */
export function price(balance: bigint, cfg: Pick<Config, 'share' | 'floor' | 'ceiling' | 'keep'>): bigint {
  const spendable = balance > cfg.keep ? balance - cfg.keep : 0n;
  const part = (spendable * BigInt(Math.round(cfg.share * 1_000_000))) / 1_000_000n;
  return part < cfg.floor ? cfg.floor : part > cfg.ceiling ? cfg.ceiling : part;
}

const OVER_DAY = (cfg: Config, t: Tag) =>
  Date.parse(t.at) >= cfg.rules4From
    ? `this wallet had cashed in ${cfg.walletTags24} tags already in the 12 hours before: one payout of ${cfg.minTags} every 12 hours, and no more are paid to it until 12 hours after the first of those`
    : Date.parse(t.at) >= cfg.rules3From
    ? `this wallet had cashed in ${cfg.walletTags24} tags already in the 24 hours before: one payout of ${cfg.minTags} a day, and no more are paid to it until 24 hours after the first of those`
    : `this wallet had cashed in ${cfg.walletDayTags} tags already that day: no more are paid to it for that day (the day is counted in UTC)`;
/**
 * Is this tag over its wallet's limit: are there already so many of that wallet's, cashed in before it in the 24
 * hours before (from `rules3From`; until then, earlier that same UTC day), that are paid or to be paid? Asked by when
 * a tag was CASHED IN and not by when it comes to be paid, so that the answer is the same whenever it is asked.
 * (Five due make one payment, so five in any 24 hours is one payment of five in any 24 hours: a second would need a
 * sixth tag inside the same 24 hours as the first's last.)
 */
export function overDay(book: Book, t: Tag, cfg: Config): boolean {
  const cashed = Date.parse(t.at), day = dayOf(cashed), rolling = cashed >= cfg.rules3From;
  const before = (r: Row) => Date.parse(r.at) < cashed || (r.at === t.at && r.ref < t.ref);
  const span = windowOf(cashed, cfg), near = (r: Row) => (rolling ? cashed - Date.parse(r.at) < span : dayOf(Date.parse(r.at)) === day);
  return book.rows.filter((r) => r.ref !== t.ref && r.wallet === t.wallet && near(r) && before(r) && (r.state === 'paid' || r.state === 'sending' || r.state === 'waiting')).length >= (rolling ? cfg.walletTags24 : cfg.walletDayTags);
}

/** how long after one player has cashed another's tag the other's cashing of theirs is not paid */
export const TRADE_MS = 24 * 3600 * 1000;
/** the hours over which a tag cashed in at `cashed` is counted with its wallet's others (see `overDay`): 12 from the fourth cut-over, 24 before */
export const windowOf = (cashed: number, cfg: Pick<Config, 'rules4From'>) => (cashed >= cfg.rules4From ? 12 : 24) * 3600 * 1000;

// ------------------------------------------------------------------ what is kept

/** a tag cashed in, as the game server reports it */
export interface Entry {
  id: string;
  at: string;
  name: string;
  owner: string;
  wallet: string;
  /** the player who cashed it in, as a hash of their key (server/tags.ts): what their free tags are counted by with the wallet's */
  acct?: string;
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
  /** what of the coin its wallet held when it was cashed in, in the coin's smallest unit (from the fifth cut-over: see `holderBonus`) */
  held?: string;
  acct?: string;
}
export const tagOf = (e: Entry): Tag => ({ ref: refOf(e.id), at: e.at, name: e.name, owner: e.owner, wallet: e.wallet, ...(e.acct ? { acct: e.acct } : {}) });

/**
 * Why a tag is waiting, where that says when it is worth looking at again: asking costs, and
 * most waits end at a time that can be told without asking.
 *   funds  the treasury is short: when it holds enough again
 *   day    a limit on the day: tomorrow, or sooner if there is room under it again (the treasury
 *          has been filled since, or the limit has been raised)
 *   setup  payouts are not set up to pay (a dry run, the wrong key): when they are
 *   hand   something a person has to look at: never by itself
 *   five   its wallet has fewer tags due than it is paid for at once: when the book shows that many (told from the
 *          book alone: nothing is asked of the chain or the file service while it waits, however long that is)
 */
export type Hold = 'funds' | 'day' | 'setup' | 'hand' | 'five' | 'coin';

export type Outcome =
  | { state: 'paid'; lamports: number; signature: string; at: string; receipt?: string }
  /** its attempt is written down, its place in the day's limits is taken, and its payment is on the way */
  | { state: 'sending'; lamports: number; signature: string }
  /**
   * will be paid when it can be: nothing more is needed from the player.
   * `have` of `need`: how many of its wallet's tags are due, of how many it is paid for at once (said when it is
   * told, never written down: the count moves). `parked`: it was in the book already and still waits for the count,
   * so there is nothing to ask about again: it is paid from the book when the count is reached (see api/cashin.ts).
   */
  | { state: 'waiting'; why: string; hold?: Hold; have?: number; need?: number; parked?: true }
  /** will not be paid, and why. `gone`: and it is not kept: not written in the book, and taken out of it if it is there (see `closed`) */
  | { state: 'skipped'; why: string; gone?: true }
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
  /** 2: under the rules of the second cut-over (flat pay, paid when its wallet has enough due). Written when the tag is first put in the book. */
  rules?: 2;
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
  /** tags paid, by wallet (`w:`) and by player (`a:`), as far back as the book knows: what `pastFree` counts. Read from the rows the first time a tag is paid (they keep only the latest ROWS_KEPT) */
  free?: Record<string, number>;
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
/**
 * Taken in, and kept waiting by this machine: for room under the day's limits, for the treasury to fill, or for its
 * wallet to have enough due. Such a tag came in time, and is never too old, however long the wait.
 *
 * Under the second cut-over that is also so of one that waits for payouts to be set up to pay (`setup`). There a
 * tag ordinarily waits days for the others, and may be ten days old when its turn comes: if its turn came on a dry
 * run, or at a moment when the chain could not say who made the coin, it was written down `setup`, was from then on
 * neither counted among its wallet's nor looked at again (it was past four days), and would have been refused as
 * too old if it had been. Its wallet's other tags then waited at "4 of 5" for good.
 * (A tag from before the cut-over is left exactly as it was in this: looked at for four days, refused after three.)
 */
const owed = (r: Row | undefined) => r?.state === 'waiting' && (r.hold === 'day' || r.hold === 'funds' || r.hold === 'five' || (r.hold === 'setup' && r.rules === 2));

/** Is a tag under the rules of the second cut-over? Its row says, once it has one; until then, when it was cashed in. */
const fives = (cfg: Config, t: { at: string }, had?: Row | null) => (had ? had.rules === 2 : Date.parse(t.at) >= cfg.rules2From);
const FIVE = (cfg: Config) => `paid when ${cfg.minTags} of this wallet's tags are due`;
/**
 * THE OLD BOOK IS CLOSED AT THE SECOND CUT-OVER. The owner, 2026-10-13: "i want to cancel all current pending
 * payouts and move forward wihtour new payout tracking system", and "all waiting and not paid tags on the payout
 * screen will now be deleted entirely."
 *
 * So from that moment a tag cashed in before it that has not been paid is not paid: not waited for, not tried
 * again, and not kept. It is taken out of the book, with every tag of before that was refused or only listed, and
 * the list shows what was paid and what has come since. What was paid stays paid. A payment that was already on its
 * way at the moment is followed to its end first: if it arrives the tag is paid, and only if it is seen to be lost
 * is the tag taken out.
 *
 * It is a rule of the tag's own time, so nothing has to be remembered for it to hold: asked about such a tag in a
 * year, by anybody, the answer is the same, and nothing is written. (Taking the rows out and no more would not have
 * held: the game server asks again about a tag it has not seen settled, and a tag the book does not know is a new
 * tag.) What has been taken out is not put back by moving or removing the moment afterwards.
 */
const CLOSED = 'cashed in before the payout rules changed: what was not paid by then is not paid';
const GONE: Outcome = { state: 'skipped', why: CLOSED, gone: true };
/** Is this a tag of before the second cut-over, now that the cut-over has come? (Its row says which rules it is under, once it has one.) */
const closed = (cfg: Config, t: { at: string }, now: number, had?: Row | null) => now >= cfg.rules2From && !fives(cfg, t, had);
/**
 * Takes out of the book every tag of before the second cut-over that is not paid and has no attempt on record:
 * nothing need be asked of the chain about those. (One with an attempt on record is seen to by `settle`, which
 * asks.) The count of tags goes down with them: it is the count of what the list holds and has held.
 * @returns how many were taken out
 */
const shutNow = (r: Row) => !(r.rules === 2 || r.state === 'paid' || r.state === 'sending' || !!r.tries?.length);
export function shutOld(book: Book): number {
  const kept = book.rows.filter((r) => !shutNow(r));
  const n = book.rows.length - kept.length;
  book.rows = kept;
  book.tags = Math.max(kept.length, book.tags - n);
  return n;
}
/**
 * How many of a wallet's tags must be due before it is paid, as things stand at this moment: `minTags` while the
 * second cut-over is in force, and one while it is not. It is not in force before its moment, when there is no
 * tag under it to ask about; and it is not in force when it has been PUT OFF after it began (the moment taken away
 * again, or moved on): then whatever the book holds under it is paid as it stands, a wallet at a time. That is the
 * way back, and it needs nothing but the setting.
 */
export const needOf = (w: Pick<World, 'cfg' | 'now'>) => (w.now() >= w.cfg.rules2From ? w.cfg.minTags : 1);

/**
 * A wallet's tags that are DUE: under the rules of the second cut-over, to be paid by every other rule (one that
 * is not to be paid is never left waiting: it is written down as not paid, and is not here), and not begun on.
 * They wait for nothing but each other, for room under the day's limit, or for the treasury; and they are paid
 * together, all of them, when there are `minTags` of them.
 * @param but a tag to leave out (the one in hand, which may or may not be in the book yet)
 */
export function dueOf(book: Book, wallet: string, but?: string): Row[] {
  return book.rows.filter((r) => r.rules === 2 && r.wallet === wallet && r.ref !== but && owed(r) && !r.tries?.length && !r.legacy);
}
/**
 * The tags a waiting one is paid with. Before the second cut-over: itself alone. Under it: all of its wallet's that
 * are due, if it has not been begun on; and if it has, the tags of its last attempt, which every later attempt is
 * for (as `settle` puts them together). Never none: a pack that had been tried and then found the treasury short
 * used to come out as no tags at all, cost nothing in the reckoning below, and so was tried again at every look.
 */
function lotOf(book: Book, r: Row): Row[] {
  if (r.rules !== 2) return [r];
  const n = r.tries?.length ?? 0;
  if (!n) {
    const lot = dueOf(book, r.wallet);
    return lot.some((x) => x.ref === r.ref) ? lot : [r, ...lot];
  }
  const last = r.tries![n - 1].signature;
  return book.rows.filter((x) => x.ref === r.ref || (x.wallet === r.wallet && open(x) && x.tries?.length === n && x.tries[n - 1].signature === last));
}
/**
 * What a waiting tag is reckoned to cost the treasury: what it would be paid now. And for one under the second
 * cut-over that has been begun on, what its first attempt set out to pay, which is what every later one pays.
 */
const costOf = (cfg: Config, r: Row, holds: bigint) => (r.rules === 2 && r.tries?.length && r.lamports ? BigInt(r.lamports) : price(holds, termsOf(cfg, r.at, r.rules === 2)));

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

/**
 * Puts a tag and what became of it in the book (a tag already down as paid stays as it is).
 * @param five it is under the rules of the second cut-over: written on it if this is where it is first put down
 */
export function enter(book: Book, t: Tag, o: Outcome, day: string, five = false): Row {
  let row = book.rows.find((r) => r.ref === t.ref);
  if (!row) {
    row = { ref: t.ref, at: t.at, name: t.name, owner: t.owner, wallet: t.wallet, state: 'off' };
    if (five) row.rules = 2;
    if (t.held !== undefined) row.held = t.held;
    if (t.acct) row.acct = t.acct;
    book.rows.push(row);
    book.tags++;
  }
  if (row.state === 'paid') return row;
  // (read from the rows before this one is down as paid, and counted below)
  if (o.state === 'paid') book.free ??= paidBy(book);
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
    for (const k of freeKeys(row)) book.free![k] = (book.free![k] ?? 0) + 1;
  }
  return row;
}

/** how many tags the book knows to have been paid to a wallet (`w:` and its address) or a player (`a:`): see `pastFree` */
export const paidTo = (book: Book, key: string) => (book.free ?? paidBy(book))[key] ?? 0;
/** what a tag's free tags are counted by: its wallet, and the player who cashed it in where the game server said */
const freeKeys = (t: Pick<Tag, 'wallet' | 'acct'>) => [`w:${t.wallet}`, ...(t.acct ? [`a:${t.acct}`] : [])];
function paidBy(book: Book): Record<string, number> {
  const n: Record<string, number> = {};
  for (const r of book.rows) if (r.state === 'paid') for (const k of freeKeys(r)) n[k] = (n[k] ?? 0) + 1;
  return n;
}
/**
 * Has this tag's wallet, or the player who cashed it in, had its free tags (see `rules6From`)? Those paid count, and
 * with them those on their way and those the book will pay when their turn comes: each of them is one of the free.
 * (Both are counted so that neither a new wallet nor a new player starts the count again by itself.)
 */
export function pastFree(book: Book, t: Tag, cfg: Pick<Config, 'freeTags'>): boolean {
  const paid = book.free ?? paidBy(book);
  return freeKeys(t).some((k) => (paid[k] ?? 0) + book.rows.filter((r) => r.ref !== t.ref && (r.state === 'sending' || owed(r)) && freeKeys(r).includes(k)).length >= cfg.freeTags);
}
const coins = (raw: bigint) => Number(raw / 10n ** COIN_DECIMALS).toLocaleString('en-US');
const HOLD_MIN = (cfg: Config, held: bigint) =>
  `past its first ${cfg.freeTags} paid tags, a wallet is paid only while it holds ${coins(cfg.holdMin)} $ZONA, and this one held ${coins(held)} (the lower of when the tag was cashed in and now)`;
/** (the same words every time it is looked at, so that the book is not written again for it: see `says`) */
const HOLD_WAIT = (cfg: Config) =>
  `past its first ${cfg.freeTags} paid tags, a wallet is paid only while it holds ${coins(cfg.holdMin)} $ZONA: this tag is paid as soon as it does, if within ${Math.round(cfg.holdWait / 3600_000)} hours of being cashed in`;
const HOLD_LATE = (cfg: Config) =>
  `past its first ${cfg.freeTags} paid tags, a wallet is paid only while it holds ${coins(cfg.holdMin)} $ZONA, and this one did not within ${Math.round(cfg.holdWait / 3600_000)} hours of the tag being cashed in`;
/** a tag refused under the sixth for want of the coin, cashed in recently enough to wait for it under the seventh */
const reopens = (cfg: Config, now: number, r: Row) =>
  now >= cfg.rules7From && r.state === 'skipped' && !!r.why?.startsWith('past its first ') && r.why.includes('the lower of when the tag was cashed in and now') && Date.parse(r.at) >= cfg.rules6From && now - Date.parse(r.at) < cfg.holdWait;
/** Those, waiting for the coin from now: how many. */
export function reopen(cfg: Config, now: number, book: Book): number {
  const day = dayOf(now);
  const them = book.rows.filter((r) => reopens(cfg, now, r));
  for (const r of them) enter(book, r, { state: 'waiting', why: HOLD_WAIT(cfg), hold: 'coin' }, day);
  return them.length;
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
/** work allowed: a payment with its receipt and note uses about fifteen thousand units (and as much again for each tag more that it pays); a claim, about sixty thousand */
export const PAY_UNITS = 40_000;
const CLAIM_UNITS = 250_000;
/**
 * How many tags one transaction pays at most. A transaction may be 1232 bytes: with five receipts, the payment and
 * the note naming all five it is 1205, and a sixth receipt does not fit. A wallet with more due is paid in several.
 */
export const LOT_MAX = 5;

/**
 * One payment, for one tag or for several of one wallet's: a receipt for each tag first (so that none of them can
 * ever be paid again: if any one of the receipts is there already the whole transaction fails, and nothing moves),
 * then the money for all of them in one transfer, and a note naming them. This is the only place a payment is put
 * together, and what it sends is exactly the sum of what the tags it makes receipts for are paid: so a tag's money
 * can leave the treasury only in a transaction that makes that tag's receipt, and that can happen once.
 */
export function payment(treasury: Bytes, to: Bytes, tags: { ref: string; lamports: bigint }[], bid: number): Instruction[] {
  if (!tags.length || tags.length > LOT_MAX || new Set(tags.map((x) => x.ref)).size !== tags.length) throw new Error('not the tags of one payment');
  const sum = tags.reduce((s, x) => s + x.lamports, 0n);
  return [computeLimit(PAY_UNITS * tags.length), computePrice(bid), ...tags.map((x) => receipt(treasury, x.ref)), transfer(treasury, to, sum), memo(`ZONA dog tag ${tags.map((x) => x.ref).join(' ')}`)];
}

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
/** the same for several sent together (a wallet with more due than one transaction carries): which of them arrived */
async function watchAll(w: World, txs: Signed[]): Promise<boolean[]> {
  if (txs.length === 1) return [await watch(w, txs[0])];
  const done = txs.map(() => false), dead = txs.map(() => false);
  for (let waited = 0; waited < WATCH_MS && done.some((d, i) => !d && !dead[i]); waited += 1200) {
    await w.sleep(1200);
    const seen = await w.rpc.statuses(txs.map((x) => x.signature)).catch(() => [] as (Status | null)[]);
    txs.forEach((_, i) => {
      if (landed(seen[i])) done[i] = true;
      else if (seen[i]?.err && seen[i]!.confirmationStatus === 'finalized') dead[i] = true;
    });
  }
  return done;
}

/** where the coin's rewards stand, asked of the chain at most four times a minute (and no staler than what the treasury is seen to hold: the page shows the two side by side) */
const coin = (w: World) => cached(w, 'coin', 15_000, () => (w.coin ?? coinState)(w.rpc, w.cfg.mint));
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

/**
 * Whether there is room under today's limits for a tag that was held by them: the treasury
 * has been filled since (the limit is a share of the most it has held today), or the limit
 * itself has been raised. The same sum that is done, with the book in hand, when it is paid:
 * this one is done from a copy that may be a minute old, and only decides whether to ask.
 */
async function roomToday(w: World, r: Row, book: Book): Promise<boolean> {
  const cfg = w.cfg, day = dayOf(w.now());
  if (!cfg.treasury) return false;
  const today = book.rows.filter((x) => x.ref !== r.ref && x.day === day && (x.state === 'paid' || x.state === 'sending'));
  // (a wallet's tags under the second cut-over are held by its count of tags DUE, and by nothing about what it was paid today)
  if (r.rules !== 2 && today.filter((x) => x.wallet === r.wallet).length >= cfg.walletDayTags) return false;
  if (!today.length) return true;
  const balance = await treasuryHolds(w);
  const most = Math.max(book.most?.day === day ? book.most.lamports : 0, Number(balance));
  const allowed = (BigInt(most) * BigInt(Math.round(cfg.dayShare * 1000))) / 1000n;
  const spent = today.reduce((s, x) => s + BigInt(x.lamports ?? 0), 0n);
  // (all that it is paid with go together or not at all: the room has to be for all of them)
  return spent + lotOf(book, r).reduce((s, x) => s + costOf(cfg, x, balance), 0n) <= allowed;
}

/**
 * Whether a tag that is not settled is worth looking at again now.
 * @param book the book as it was glanced at (a tag held by the day's limits is weighed against it)
 */
async function due(w: World, r: Row, book: Book): Promise<boolean> {
  if (r.state === 'sending') return true;
  if (r.state !== 'waiting' || r.hold === 'hand') return false;
  const setUp = async () => w.cfg.mode === 'on' && (await setup(w).catch(() => 'not known')) === null;
  // (waiting for its wallet's count: the book alone says when, and until then nothing is asked of anybody)
  if (r.hold === 'five') {
    if (r.rules !== 2) return true;
    const lot = dueOf(book, r.wallet);
    if (lot.length < needOf(w)) return false;
    // (there are enough, and one of them waits for payouts to be set up to pay: then so do they all, and none of
    // them is asked about, or written down again as waiting for that, until they are)
    return !lot.some((x) => x.hold === 'setup') || setUp();
  }
  if (r.hold === 'day') return r.heldOn !== dayOf(w.now()) || roomToday(w, r, book);
  if (r.hold === 'setup') return setUp();
  if (r.hold === 'funds' && w.cfg.treasury) {
    // (when the treasury, with whatever rewards could be collected into it, would cover a tag, or all the tags it is
    // paid with: every one of them at what it costs, so that tags the treasury cannot pay are not asked about, and
    // nothing is collected, sent or written for them, until it can)
    const has = await treasuryHolds(w);
    const s = w.cfg.mode === 'on' ? await coin(w).catch(() => null) : null;
    const more = s && s.creator && same(s.creator, w.cfg.treasury) && !s.unsupported ? s.curve + s.pool : 0n;
    const lot = lotOf(book, r);
    return has + more >= lot.reduce((sum, x) => sum + costOf(w.cfg, x, has + more) + EMPTY_ACCOUNT_RENT, 0n) + FEE_ROOM * BigInt(Math.ceil(lot.length / LOT_MAX)) + w.cfg.keep;
  }
  return true;
}

// ------------------------------------------------------------------ paying a tag, or several of one wallet's

/** what was found of a tag, and of every other tag that was seen to with it */
type Said = { t: Tag; o: Outcome; five: boolean }[];
/** one of the tags a payment is for */
interface One {
  t: Tag;
  had: Row | undefined;
  five: boolean;
  tries: Try[];
  /** the address of its receipt */
  mine: string;
  amount: bigint;
}
const tagOfRow = (r: Row): Tag => ({ ref: r.ref, at: r.at, name: r.name, owner: r.owner, wallet: r.wallet, ...(r.held !== undefined ? { held: r.held } : {}), ...(r.acct ? { acct: r.acct } : {}) });

/**
 * The holder tiers, by millions of the coin held: names for the steps of `holderBonus`, the owner, 2026-10-15: "the payouts
 * page should change, showing the new tiered system to inscentivzie new buyers, and also showing how much the player
 * will earn in sol per tag". What a tag pays is set by the whole millions held, not by the tier: a tier is where it
 * is said. The last is wherever a tag is paid the most (`tagMax`): "players ... that are at MAX level or prestige ...
 * to make it seem like theyre elite almost".
 */
export const TIERS = [
  { from: 0, name: 'Recruit' },
  { from: 1, name: 'Soldier' },
  { from: 5, name: 'Veteran' },
  { from: 10, name: 'Commander' },
  { from: 15, name: 'Elite' },
] as const;

/** what a tag pays a wallet holding `held` (smallest unit) under the holder rule, in lamports, and its tier, as `holderBonus` pays it */
export function rateOf(cfg: Pick<Config, 'floor' | 'holderPerM' | 'tagMax'>, held: bigint) {
  const millions = Number(held / (1_000_000n * 10n ** COIN_DECIMALS));
  const top = cfg.holderPerM > 0n ? Number((cfg.tagMax - cfg.floor) / cfg.holderPerM) : 0;
  const pays = (m: number) => { const more = BigInt(Math.min(m, top)) * cfg.holderPerM; return cfg.floor + (more < cfg.tagMax - cfg.floor ? more : cfg.tagMax - cfg.floor); };
  const tiers = TIERS.map((t, i) => ({ ...t, from: i === TIERS.length - 1 ? top : t.from }));
  const at = tiers.reduce((k, t, i) => (millions >= t.from ? i : k), 0);
  const next = tiers[at + 1];
  return { millions, tier: tiers[at].name, max: millions >= top, perTag: pays(millions), top, next: next ? { tier: next.name, from: next.from, perTag: pays(next.from) } : null, tiers: tiers.map((t) => ({ ...t, perTag: pays(t.from) })) };
}

/** a wallet's standing under the holder rule now: what it holds of the coin, and what a tag pays it (see api/cashins.ts, ?format=wallet) */
export async function walletRate(w: World, who: string) {
  const held = await coinsOf(w, address(who));
  return { held, ...rateOf(w.cfg, held) };
}

/** what of the coin a wallet holds now, in its smallest unit: its own account for the coin under either token program */
async function coinsOf(w: World, who: Bytes): Promise<bigint> {
  const mint = w.cfg.mint;
  const [a, b] = await Promise.all([w.rpc.tokenBalance(tokenAccount(who, mint, TOKEN_2022_PROGRAM)), w.rpc.tokenBalance(tokenAccount(who, mint, TOKEN_PROGRAM))]);
  return a + b;
}

/**
 * What a tag is paid more for its wallet's holding of the coin (see `rules5From`): `holderPerM` for every whole
 * million coins of the lower of what was held when it was cashed in and `now`, so long as the tag in all pays no more
 * than `tagMax`. Nothing for a tag of before the fifth cut-over, or not under the rule of five.
 */
export function holderBonus(cfg: Pick<Config, 'rules5From' | 'holderPerM' | 'tagMax'>, t: Tag, five: boolean, base: bigint, now: bigint): bigint {
  if (!five || Date.parse(t.at) < cfg.rules5From || t.held === undefined) return 0n;
  const then = BigInt(t.held), held = then < now ? then : now;
  // (for each whole million: nothing under one, the owner: "minimum holder requirement is 1m tokens for this to begin to kick in")
  const more = (held / (1_000_000n * 10n ** COIN_DECIMALS)) * cfg.holderPerM, room = cfg.tagMax > base ? cfg.tagMax - base : 0n;
  return more < room ? more : room;
}

/**
 * Pays a tag, or says why not, or finds that it has been paid already. Safe to call again
 * and again for the same tag, and from two places at once.
 *
 * Under the rules of the second cut-over a tag is not paid alone. It waits until its wallet has `minTags` due, and
 * then all that are due are paid together: one transaction for every five of them (LOT_MAX), each making the
 * receipt of every tag it pays. Whatever was written down as one attempt is for certain tags, and every attempt
 * after it is for the same ones: but nothing rests on that. A tag's money is only ever in a transaction that
 * makes that tag's receipt (see `payment`), so however the tags are put together, and whatever this code believes,
 * the chain lets each of them be paid once; and a transaction happens whole or not at all, so nobody is ever paid
 * for some of the tags of one and not the others.
 * @param at the book as last read; left holding the book as this last wrote it
 * @returns what became of the tag, and of every other tag this saw to with it
 */
async function settle(w: World, t: Tag, at: { held: Held }, again = false): Promise<Said> {
  const cfg = w.cfg;
  const book = at.held.book;
  const had = book.rows.find((r) => r.ref === t.ref);
  const five = fives(cfg, t, had);
  const only = (o: Outcome): Said => [{ t, o, five }];
  if (cfg.mode === 'off' || !cfg.treasury) return only({ state: 'off' });
  const treasury = cfg.treasury;
  const now = w.now();
  const tries = had?.tries ?? [];

  // begun by the version before this one, whose payments left no receipt to tell by: paid if
  // its payment is seen to have arrived, and otherwise for a person to settle, never the machine
  // (a tag of before the second cut-over, now that it has come: see `closed`)
  const shut = closed(cfg, t, now, had);
  if (had?.legacy) {
    const [s] = had.signature ? await w.rpc.statuses([had.signature]) : [null];
    if (landed(s)) return only({ state: 'paid', lamports: had.lamports ?? 0, signature: had.signature!, at: iso(now) });
    return only(shut ? GONE : { state: 'skipped', why: 'left unfinished by an earlier version of this system: to be settled by hand' });
  }
  // (nothing was ever sent for it: there is nothing to ask the chain)
  if (shut && !tries.length) return only(GONE);

  if (!t.wallet) return only({ state: 'skipped', why: 'no wallet given' });
  let to: Bytes;
  try {
    to = address(t.wallet);
  } catch {
    return only({ state: 'skipped', why: 'not a wallet address' });
  }
  if (same(to, treasury)) return only({ state: 'skipped', why: 'not a wallet that can be paid' });
  // (what its wallet holds of the coin, asked once and only where it counts: written on the tag the first time it is put down, see `holderBonus`)
  let holding: Promise<bigint> | null = null;
  const holds = () => (holding ??= coinsOf(w, to).catch(() => 0n));
  if (had?.held !== undefined) t.held ??= had.held;
  // (not read is not none: past its free tags a tag written down as held by a wallet holding nothing would not be paid, so
  // a node that cannot say leaves it to be asked again, and it is then judged by what is held at that asking)
  if (!had && five && Date.parse(t.at) >= cfg.rules5From) t.held = String(await (holding = coinsOf(w, to)));

  // --- the tags it goes with: those its last attempt was for, if it has been tried (before the second cut-over, itself alone)
  const one = (x: Tag, row: Row | undefined): One => ({ t: x, had: row, five: fives(cfg, x, row), tries: row?.tries ?? [], mine: b58(seeded(treasury, x.ref)), amount: 0n });
  let lot: One[] = [one(t, had)];
  if (tries.length) {
    const last = tries[tries.length - 1].signature;
    for (const r of book.rows) if (r.ref !== t.ref && r.wallet === t.wallet && open(r) && r.tries?.length === tries.length && r.tries[tries.length - 1].signature === last) lot.push(one(tagOfRow(r), r));
  }
  const said: Said = [];
  const say = (m: One, o: Outcome) => void said.push({ t: m.t, o, five: m.five });

  // --- has it been paid? The chain says: its receipt is there, or it is not. (Asked of each tag by itself.)
  const receiptSays = async (m: One): Promise<Outcome | null> => {
    for (const place of new Set([m.mine, ...m.tries.map((x) => x.receipt)])) {
      if (!(await w.rpc.account(address(place)))) continue;
      // an account where its receipt would go, and no attempt of ours on record: not ours. Nothing is sent.
      const made = m.tries.filter((x) => x.receipt === place);
      if (!made.length) return { state: 'waiting', why: 'the address of its receipt is already in use: this one needs looking at', hold: 'hand' };
      // (which of the attempts it was, if the node remembers; the last of them if it does not)
      const seen = await w.rpc.statuses(made.map((x) => x.signature)).catch(() => [] as (Status | null)[]);
      const hit = made.find((_, i) => landed(seen[i])) ?? made[made.length - 1];
      return { state: 'paid', lamports: m.had?.lamports ?? 0, signature: hit.signature, at: hit.at, receipt: place };
    }
    return null;
  };
  /** those of them the chain has no receipt for (what it says of the others is said) */
  const unpaid = async (all: One[]) => {
    const left: One[] = [];
    for (const m of all) {
      const o = await receiptSays(m);
      if (o) say(m, o);
      else left.push(m);
    }
    return left;
  };
  lot = await unpaid(lot);
  if (!lot.length) return said;

  // --- attempts made before: is one of them still on its way?
  if (tries.length) {
    // (how far the chain has got and what it has seen are asked of one node, so that the two answers agree)
    const node = await w.rpc.steady();
    const height = await node.blockHeight();
    const seen = await node.statuses(tries.map((x) => x.signature));
    const hit = tries.findIndex((_, i) => landed(seen[i]));
    if (hit >= 0) {
      for (const m of lot) say(m, { state: 'paid', lamports: m.had?.lamports ?? 0, signature: tries[hit].signature, at: tries[hit].at, receipt: m.tries[hit].receipt });
      return said;
    }
    const gone = (x: Try, i: number) => (seen[i] ? !!seen[i]!.err && seen[i]!.confirmationStatus === 'finalized' : height > x.lastValid + DEAD_MARGIN);
    const alive = tries.filter((x, i) => !gone(x, i));
    if (alive.length) {
      const last = alive[alive.length - 1];
      // the very same transaction once more does no harm and may help it along
      await w.rpc.send({ wire: Uint8Array.from(Buffer.from(last.wire, 'base64')), signature: last.signature }).catch(() => {});
      for (const m of lot) say(m, { state: 'sending', lamports: m.had?.lamports ?? 0, signature: last.signature });
      return said;
    }
    // (every attempt made for it is seen to be lost, and the old book is closed: no other is made)
    if (shut) {
      for (const m of lot) say(m, GONE);
      return said;
    }
    if (tries.length >= MAX_TRIES) {
      for (const m of lot) say(m, { state: 'waiting', why: `${MAX_TRIES} attempts did not go through: this one needs looking at`, hold: 'hand' });
      return said;
    }
  } else {
    // --- whether it is to be paid at all (asked afresh each time until its first attempt)
    // (too old is said of a tag that comes late. One the book has had waiting, for room under the day's limits, for
    // the treasury to fill, or for its wallet to have enough due, came in time: the wait since is this machine's
    // own, and is not counted against it, however long it is.
    // Before 2026-10-12 it was, and a wallet with more tags than three days of its limit lost the rest.)
    if (!owed(had) && !(now - Date.parse(t.at) < MAX_AGE_MS)) return only({ state: 'skipped', why: 'cashed in more than three days ago' });
    const since = book.since;
    if (since && Date.parse(t.at) < Date.parse(since)) return only({ state: 'skipped', why: 'cashed in before automatic payouts began' });
    // (asked of a tag until it has been taken in: of none that the book has waiting to be paid, which was asked
    // when it came. It was asked only of a tag the book had not heard of. But a tag whose first asking met trouble
    // at the node is written down before it has been asked anything at all, as waiting and no more: at its next
    // asking the book had heard of it, the rule was passed over, and a traded tag was paid.)
    if (!owed(had) && Date.parse(t.at) >= cfg.rulesFrom && traded(book, t)) return only({ state: 'skipped', why: `you and ${t.owner.slice(0, 16)} have cashed each other's tags inside a day: the second of the two is not paid` });
    // (and one over its wallet's three for the day is told so at once, not told to wait for a treasury that will
    // not pay it when it fills: asked again where it is written down, below)
    if (Date.parse(t.at) >= cfg.rulesFrom && overDay(book, t, cfg)) return only({ state: 'skipped', why: OVER_DAY(cfg, t) });
    // (past its free tags, a wallet that does not hold enough of the coin is not paid: judged when it comes, as a trade is.
    // What is held now is read afresh, never taken as none for want of an answer: see above)
    if (!owed(had) && Date.parse(t.at) >= cfg.rules6From && pastFree(book, t, cfg)) {
      const nowHeld = await (holding ??= coinsOf(w, to)), then = t.held !== undefined ? BigInt(t.held) : nowHeld, held = then < nowHeld ? then : nowHeld;
      // (under the seventh, what it holds now, and a wait for it: see `rules7From`. A tag that waits is not owed, so it
      // is asked this again each time it is looked at)
      if (now >= cfg.rules7From) {
        if (nowHeld < cfg.holdMin) return only(now - Date.parse(t.at) < cfg.holdWait ? { state: 'waiting', why: HOLD_WAIT(cfg), hold: 'coin' } : { state: 'skipped', why: HOLD_LATE(cfg) });
      } else if (held < cfg.holdMin) return only({ state: 'skipped', why: HOLD_MIN(cfg, held) });
    }
    const wrong = await setup(w);
    if (wrong) return only({ state: 'waiting', why: wrong, hold: 'setup' });
    const there = await w.rpc.account(to);
    if (there && !same(there.owner, SYSTEM_PROGRAM)) return only({ state: 'skipped', why: 'that address is not a wallet (it belongs to a program)' });
    // an address nobody can hold the key to, and that has never been used: money sent there is gone
    if (!there && !onCurve(to)) return only({ state: 'skipped', why: 'that address is not a wallet anybody holds the key to' });

    // --- under the second cut-over: has its wallet enough of them due? If not it waits, and nothing more is asked.
    if (five) {
      // (how many it takes: one, if the rule has been put off since this tag was taken in under it. See `needOf`.)
      const need = needOf(w);
      const mates = dueOf(book, t.wallet, t.ref);
      if (mates.length + 1 < need) return only({ state: 'waiting', why: FIVE(cfg), hold: 'five' });
      // (each of the others is asked of the chain as this one was: one with a receipt there already is not paid again)
      lot = [...lot, ...(await unpaid(mates.map((r) => one(tagOfRow(r), r))))];
      if (lot.length < need) return [...said, ...only({ state: 'waiting', why: FIVE(cfg), hold: 'five' })];
      // whoever has waited longest first
      lot.sort((a, b) => (a.t.at < b.t.at ? -1 : a.t.at > b.t.at ? 1 : a.t.ref < b.t.ref ? -1 : 1));
    }
  }

  // --- how much (what the first attempt set out to pay is what every later one pays), and whether the treasury can cover it
  let balance = await w.rpc.balance(treasury);
  for (const m of lot) {
    if (m.tries.length && m.had?.lamports) {
      m.amount = BigInt(m.had.lamports);
      continue;
    }
    const base = price(balance, termsOf(cfg, m.t.at, m.five));
    m.amount = base + (m.five && Date.parse(m.t.at) >= cfg.rules5From ? holderBonus(cfg, m.t, m.five, base, await holds()) : 0n);
  }
  // (as many as one transaction carries in each)
  const packs: One[][] = [];
  for (let i = 0; i < lot.length; i += LOT_MAX) packs.push(lot.slice(i, i + LOT_MAX));
  const total = lot.reduce((s, m) => s + m.amount, 0n);
  const short = () => balance < total + EMPTY_ACCOUNT_RENT * BigInt(lot.length) + FEE_ROOM * BigInt(packs.length) + cfg.keep;
  if (short() && cfg.mode === 'on') {
    // bring the rewards home first, whatever there is of them
    await claim(w, true).catch(() => {});
    balance = await w.rpc.balance(treasury);
  }
  if (short()) {
    for (const m of lot) say(m, { state: 'waiting', why: 'the treasury is too low: paid when the next creator rewards come in', hold: 'funds' });
    return said;
  }

  // --- the payment: the receipts first (so it can only ever happen once), the money, and a note saying what it is for
  const { blockhash, lastValidBlockHeight } = await w.rpc.latestBlockhash();
  const todo = packs.map((pack) => payment(treasury, to, pack.map((m) => ({ ref: m.t.ref, lamports: m.amount })), cfg.bid));
  if (cfg.mode === 'dry' || !cfg.key) {
    // a dry run stops here: put together and tried on a node, and not sent
    for (const [i, pack] of packs.entries()) {
      const sim = await w.rpc.simulate(unsigned(treasury, todo[i], blockhash));
      for (const m of pack) say(m, { state: 'waiting', why: `dry run: would pay ${sol(m.amount)} SOL${pack.length > 1 ? `, with ${pack.length - 1} more in one transaction` : ''} (${sim.err ? 'and it would FAIL: ' + JSON.stringify(sim.err) : 'tried, and it would go through'})`, hold: 'setup' });
    }
    return said;
  }

  // --- sign; write the attempt in the book, and with it the tags' place in the day's limits; and only then send
  const key = cfg.key;
  const txs = todo.map((ixs) => signed(key, ixs, blockhash));
  const attempt = new Map<string, Try>();
  packs.forEach((pack, i) => pack.forEach((m) => attempt.set(m.t.ref, { signature: txs[i].signature, lastValid: lastValidBlockHeight, wire: Buffer.from(txs[i].wire).toString('base64'), at: iso(now), receipt: m.mine })));
  const day = dayOf(now);
  const found: { wait: Said | null; theirs: boolean } = { wait: null, theirs: false };
  at.held = await editBook(
    w,
    (b) => {
      found.wait = null;
      found.theirs = false;
      const rows = new Map(lot.map((m) => [m.t.ref, b.rows.find((r) => r.ref === m.t.ref)]));
      // somebody else has been at one of these since the book was read: it is theirs
      const taken = (m: One) => {
        const row = rows.get(m.t.ref);
        if (m.t.ref === t.ref || m.tries.length) return !!row && (row.state === 'paid' || (row.tries?.length ?? 0) !== m.tries.length);
        // (one that was waiting in the book for the others has to be waiting there still)
        return !row || !owed(row) || !!row.tries?.length;
      };
      if (lot.some(taken)) return !(found.theirs = true);
      if (!tries.length) {
        const mine = new Set(lot.map((m) => m.t.ref));
        const today = b.rows.filter((r) => !mine.has(r.ref) && r.day === day && (r.state === 'paid' || r.state === 'sending'));
        const spent = today.reduce((s, r) => s + BigInt(r.lamports ?? 0), 0n);
        // the day's limit is a share of the most the treasury has been seen to hold that day: kept in
        // the book, so that everybody goes by the same figure whenever each of them happened to look
        if (b.most?.day !== day) b.most = { day, lamports: 0 };
        b.most.lamports = Math.max(b.most.lamports, Number(balance));
        const allowed = (BigInt(b.most.lamports) * BigInt(Math.round(cfg.dayShare * 1000))) / 1000n;
        const full = today.filter((r) => r.wallet === t.wallet).length >= cfg.walletDayTags;
        const wait: Said = [];
        // The wallet's limit, for what is cashed in under the rules of 2026-10-13: it is on what a wallet CASHES IN
        // in a day, and is asked of the tag by the day it was cashed in and its place among that day's, whenever
        // it comes to be paid. The first three of a day are paid, today or when the treasury can; a fourth is not.
        // (It was asked by what had been PAID on the day of the paying. A tag that was one of its day's three and
        // had been told to wait for the treasury was then refused for good, the day the treasury filled, if three
        // of the next day's had gone out before it: found on reading, 2026-10-13, before it happened to anybody.)
        for (const m of lot) {
          if (Date.parse(m.t.at) >= cfg.rulesFrom) {
            if (overDay(b, m.t, cfg)) wait.push({ t: m.t, o: { state: 'skipped', why: OVER_DAY(cfg, m.t) }, five: m.five });
          } else if (full) wait.push({ t: m.t, o: { state: 'waiting', why: `this wallet has been paid for ${cfg.walletDayTags} tags today: the rest wait for tomorrow`, hold: 'day' }, five: m.five });
        }
        // (one of several is not to be paid after all: what was signed is not sent, and the rest wait to be counted again)
        if (wait.length && lot.length > 1) for (const m of lot) if (!wait.some((x) => x.t.ref === m.t.ref)) wait.push({ t: m.t, o: { state: 'waiting', why: FIVE(cfg), hold: 'five' }, five: m.five });
        // (the first of the day always goes: a limit smaller than one tag would stop everything. And all of a
        // wallet's that are due go together or wait together: there has to be room for all of them.)
        if (!wait.length && today.length && spent + total > allowed) for (const m of lot) wait.push({ t: m.t, o: { state: 'waiting', why: "today's limit on what leaves the treasury has been reached: this one is paid when there is room again", hold: 'day' }, five: m.five });
        if (wait.length) {
          found.wait = wait;
          let changed = false;
          for (const x of wait) {
            const row = rows.get(x.t.ref);
            if (row && says(row, x.o, day)) continue;
            enter(b, x.t, x.o, day, x.five);
            changed = true;
          }
          return changed;
        }
      }
      for (const m of lot) enter(b, m.t, { state: 'sending', lamports: Number(m.amount), signature: attempt.get(m.t.ref)!.signature }, day, m.five).tries = [...m.tries, attempt.get(m.t.ref)!];
    },
    at.held,
  );
  if (found.theirs) {
    // (of several, put together from a reading that somebody has written over since: put together again, once, from the book as it is)
    if (lot.length > 1 && !again) return settle(w, t, at, true);
    for (const m of lot) {
      const theirs = at.held.book.rows.find((r) => r.ref === m.t.ref);
      if (theirs) say(m, told(theirs));
      else if (m.t.ref === t.ref) say(m, { state: 'waiting', why: 'being seen to' });
    }
    return said;
  }
  if (found.wait) return [...said, ...found.wait];

  // (a node that will not take it has not necessarily not passed it on: either way it is now an attempt, to be waited out)
  for (const tx of txs) await w.rpc.send(tx).catch(refused('a payment'));
  const arrived = await watchAll(w, txs);
  packs.forEach((pack, i) =>
    pack.forEach((m) => say(m, arrived[i] ? { state: 'paid', lamports: Number(m.amount), signature: txs[i].signature, at: attempt.get(m.t.ref)!.at, receipt: m.mine } : { state: 'sending', lamports: Number(m.amount), signature: txs[i].signature })),
  );
  return said;
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
 * Two who cash each other's tags: the tag in hand is its owner's, and that owner has, inside the day before,
 * cashed a tag of whoever is cashing this one. (A quarter of everything paid by 2026-10-13 was between two players
 * who had each cashed the other: one lies down for the other, and then the other for the one.)
 *
 * A name is whatever somebody types, so both are told by more than the name: whoever has cashed to this wallet is
 * the same hand as whoever cashes to it now, and whoever cashed under the owner's name cashed to the owner's wallet.
 * @returns the other's cashing of this one's tag, if there is one that was or is to be paid
 */
export function traded(book: Book, t: Tag): Row | null {
  const said = (v: string) => v.trim().toLowerCase(), at = Date.parse(t.at), owner = said(t.owner);
  if (!owner || !t.wallet) return null;
  const mine = new Set([said(t.name)]), theirs = new Set<string>();
  for (const r of book.rows) {
    if (r.wallet && r.wallet === t.wallet) mine.add(said(r.name));
    if (r.wallet && said(r.name) === owner) theirs.add(r.wallet);
  }
  // (their own tag cashed to their own wallet under another name is not a trade: it is not anything)
  theirs.delete(t.wallet);
  return (
    book.rows.find((r) => {
      const when = Date.parse(r.at);
      if (r.ref === t.ref || !(when <= at && at - when < TRADE_MS)) return false;
      if (r.state !== 'paid' && r.state !== 'sending' && r.state !== 'waiting') return false;
      return mine.has(said(r.owner)) && (said(r.name) === owner || theirs.has(r.wallet));
    }) ?? null
  );
}

/**
 * What is told of a tag. One that waits for its wallet to have enough due is told with the count as the book has
 * it at this moment ("3 of 5: paid when 5 of this wallet's tags are due"): the count is never written on the tag,
 * because it moves with every other tag of the wallet.
 * @param known the tag was in the book before it was asked about this time
 */
function tell(w: Pick<World, 'cfg' | 'now'>, book: Book, t: Tag, o: Outcome, known = false): Outcome {
  if (o.state !== 'waiting' || o.hold !== 'five') return o;
  const cfg = w.cfg, have = dueOf(book, t.wallet).length;
  // (there is nothing to ask about again only while it is the count it waits for: with the rule put off it waits for nothing but the next look)
  return { ...o, why: `${have} of ${cfg.minTags}: ${o.why}`, have, need: cfg.minTags, ...(known && have < needOf(w) ? { parked: true as const } : {}) };
}

/**
 * A tag in hand (from the game server, or from the book): paid if it is to be, and the book
 * says what became of it, and of whichever other tags of its wallet were paid with it.
 * @param from the book as the caller has just read it; left holding the book as this wrote it
 * @returns what became of the tag, and how many tags this call found paid (itself, and those paid with it)
 */
async function seeTo(w: World, t: Tag, from?: Held): Promise<{ outcome: Outcome; paid: number }> {
  const cfg = w.cfg;
  const off = cfg.mode === 'off' || !cfg.treasury;
  if (!from) {
    // a look that costs nothing first: most asking is about tags whose answer will not change
    // (paid is paid), or cannot change yet (waiting for room under the day's limits, or for its wallet's count)
    const glanced = await glanceBook(w.store);
    const seen = glanced.rows.find((r) => r.ref === t.ref);
    if (seen && (settled(seen) || off || !(await due(w, seen, glanced)))) return { outcome: tell(w, glanced, seen, told(seen), true), paid: 0 };
  }
  const at = { held: from ?? (await freshBook(w.store)) };
  try {
    const had = at.held.book.rows.find((r) => r.ref === t.ref);
    // switched off, nothing already begun is touched: off is a stop, and what is in the book stays as it is
    if (had && (settled(had) || off)) return { outcome: tell(w, at.held.book, had, told(had), true), paid: 0 };
    // (what was first written down of a tag is what holds, whatever is said of it later)
    if (had) t = tagOfRow(had);
    // payouts begin with what was cashed in over the ten minutes before they first run
    if (cfg.mode === 'on' && !at.held.book.since) at.held = await editBook(w, (b) => (b.since ? false : (b.since = iso(w.now() - 10 * 60_000))), at.held);
    let paid = 0;
    for (let pass = 0; ; pass++) {
      let all: Said;
      let passing = false;
      try {
        all = await settle(w, t, at);
      } catch (err) {
        // not being able to ask is not a no: it is asked again, and whatever the book says of it meanwhile stands
        const now = at.held.book.rows.find((r) => r.ref === t.ref);
        if (now) return { outcome: tell(w, at.held.book, now, told(now), !!had), paid };
        all = [{ t, o: { state: 'waiting', why: `could not be done just now (${plain(err)})` }, five: fives(cfg, t) }];
        passing = true;
      }
      // written only when there is something new to say: the service counts every write. And everything there is
      // to say, of this tag and of those seen to with it, in one write.
      const day = dayOf(w.now());
      const wrote = new Map<string, Outcome>();
      let newly = 0;
      at.held = await editBook(
        w,
        (b) => {
          wrote.clear();
          newly = 0;
          let changed = false;
          for (const x of all) {
            const row = b.rows.find((r) => r.ref === x.t.ref);
            // (trouble that will pass is only written of a tag the book does not have yet: it changes nothing that is there)
            if (row && (row.state === 'paid' || passing)) continue;
            // (asked again where it is written down: of several cashed in at one moment, each was asked before the others were in the book)
            const o: Outcome = x.o.state === 'waiting' && x.o.hold === 'five' && overDay(b, x.t, cfg) ? { state: 'skipped', why: OVER_DAY(cfg, x.t) } : x.o;
            wrote.set(x.t.ref, o);
            // (the old book is closed: such a tag is not written down, and is taken out if it is there. See `closed`.)
            if (o.state === 'skipped' && o.gone) {
              if (row) {
                b.rows.splice(b.rows.indexOf(row), 1);
                b.tags = Math.max(b.rows.length, b.tags - 1);
                changed = true;
              }
              continue;
            }
            if (row && says(row, o, day)) continue;
            enter(b, x.t, o, day, x.five);
            if (o.state === 'paid') newly++;
            changed = true;
          }
          // (and one cashed in later that day, but written down before this one, may be over the day's limit now that this one is here)
          if (changed) for (const r of dueOf(b, t.wallet)) if (r.hold === 'five' && overDay(b, r, cfg)) enter(b, r, { state: 'skipped', why: OVER_DAY(cfg, r) }, day);
          return changed;
        },
        at.held,
      );
      paid += newly;
      const outcome = wrote.get(t.ref) ?? all.find((x) => x.t.ref === t.ref)?.o ?? { state: 'waiting', why: 'being seen to' };
      // Several of one wallet's cashed in at the same moment were each counted before the others were written
      // down, and each told to wait: whichever is written last finds that there are enough, and sees to them now.
      if (pass === 0 && outcome.state === 'waiting' && outcome.hold === 'five' && dueOf(at.held.book, t.wallet).length >= needOf(w)) continue;
      return { outcome: tell(w, at.held.book, t, outcome, !!had), paid };
    }
  } finally {
    if (from) Object.assign(from, at.held);
  }
}
export const handleTag = async (w: World, t: Tag, from?: Held): Promise<Outcome> => (await seeTo(w, t, from)).outcome;

/** A tag has been cashed in (or is being asked about again by the game server). */
export const handle = (w: World, e: Entry) => handleTag(w, tagOf(e));

/** Collects the rewards if it is time, and goes back over the tags in the book that are not settled yet. */
export async function sweep(w: World, limit = 200): Promise<{ tried: number; paid: number; claim: string | null }> {
  // the rewards first: what they bring in is what the waiting tags are paid with
  const claimed = await claimIfDue(w).catch((e) => `could not: ${plain(e)}`);
  let tried = 0, paid = 0;
  if (w.cfg.mode !== 'off') {
    const waiting: Row[] = [];
    let glanced = await glanceBook(w.store);
    // (The old book is closed at the second cut-over: see `closed`. What needs nothing asked of the chain goes at
    // once, in one write, and only if there is any; what has an attempt on record is seen to below, however old.)
    const shut = w.now() >= w.cfg.rules2From;
    if (shut && glanced.rows.some(shutNow)) glanced = (await editBook(w, (b) => shutOld(b) > 0)).book;
    // (and, under the seventh, what was refused for want of the coin lately waits for it: once, in one write)
    if (glanced.rows.some((r) => reopens(w.cfg, w.now(), r))) glanced = (await editBook(w, (b) => reopen(w.cfg, w.now(), b) > 0)).book;
    // What is past four days old is left alone, unless it is owed: one that never got so far as being taken in has
    // been refused as too old by then, or will not be looked at to any purpose. Under the second cut-over a payment
    // that is on its way is followed to its end as well, however old its tags: there the first attempt is
    // ordinarily made days after the first of them was cashed in, and if it was not seen to arrive in the moment
    // it was watched for, nobody looked again: it stayed "sending" for good, whether it had arrived or was lost.
    const followed = (r: Row) => owed(r) || (r.rules === 2 && r.state === 'sending') || w.now() - Date.parse(r.at) < MAX_AGE_MS + 24 * 3600 * 1000;
    for (const r of glanced.rows) if (open(r) && ((shut && r.rules !== 2) || (followed(r) && (await due(w, r, glanced))))) waiting.push(r);
    if (waiting.length) {
      const held = await freshBook(w.store);
      const began = w.now();
      // oldest first: whoever has waited longest. And not for longer than one request is allowed to take.
      for (const seen of waiting.reverse()) {
        if (tried >= limit || w.now() - began > 30_000) break;
        const r = held.book.rows.find((x) => x.ref === seen.ref);
        // (settled meanwhile, or by the seeing to of another of its wallet's a moment ago)
        if (!r || !open(r)) continue;
        tried++;
        paid += (await seeTo(w, r, held)).paid;
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
  /** the second cut-over: when it is (null: no moment is set for it), and whether it has come (from then, `share` is 0 and `tagPays` is `flatPay` whatever the treasury holds) */
  rules2From: string | null;
  fives: boolean;
  /** from the second cut-over: what a tag pays, and how many of a wallet's must be due before it is paid */
  flatPay: number;
  minTags: number;
  /** the third cut-over: when it is (null: none), whether it has come, and its limit of a wallet's tags in any 24 hours */
  rules3From: string | null;
  rolling: boolean;
  walletTags24: number;
  /** the fourth cut-over, if there is one, and how many hours a wallet's tags are counted over now (12 from it, 24 before) */
  rules4From: string | null;
  hours: number;
  /** the fifth cut-over, if there is one: SOL more a tag for every million of the coin held, and the most a tag pays */
  rules5From: string | null;
  holderPerM: number;
  tagMax: number;
  /** the coin, and its holder tiers as they stand (see `rateOf`) */
  mint: string;
  tiers: { name: string; from: number; perTag: number }[];
  /** the sixth cut-over, if there is one: how many of a wallet's or player's tags are paid with no coin held, and the whole coins a wallet must hold past them */
  rules6From: string | null;
  freeTags: number;
  holdMin: number;
  /** the seventh, if there is one: how many hours a tag past its free ones waits for its wallet to hold `holdMin` */
  rules7From: string | null;
  holdWaitH: number;
}

export async function snapshot(w: World): Promise<Snapshot> {
  const base = w.cfg;
  // (what is said is what a tag cashed in at this moment is paid by)
  const fives = w.now() >= base.rules2From;
  const cfg = fives ? termsOf(base, iso(w.now()), true) : base;
  const out: Snapshot = { mode: cfg.mode, problem: cfg.problem, treasury: cfg.treasury ? b58(cfg.treasury) : null, madeTheCoin: false, maker: null, balance: null, tagPays: null, share: cfg.share, floor: Number(cfg.floor), waiting: null, waitingNote: null, due: false, dayShare: cfg.dayShare, walletDayTags: cfg.walletDayTags, rules2From: Number.isFinite(base.rules2From) ? iso(base.rules2From) : null, fives, flatPay: Number(base.floor), minTags: base.minTags, rules3From: Number.isFinite(base.rules3From) ? iso(base.rules3From) : null, rolling: w.now() >= base.rules3From, walletTags24: base.walletTags24, rules4From: Number.isFinite(base.rules4From) ? iso(base.rules4From) : null, hours: windowOf(w.now(), base) / 3600_000, rules5From: Number.isFinite(base.rules5From) ? iso(base.rules5From) : null, holderPerM: Number(base.holderPerM) / LAMPORTS, tagMax: Number(base.tagMax) / LAMPORTS, mint: b58(base.mint), tiers: rateOf(base, 0n).tiers.map((t) => ({ name: t.name, from: t.from, perTag: Number(t.perTag) })), rules6From: Number.isFinite(base.rules6From) ? iso(base.rules6From) : null, freeTags: base.freeTags, holdMin: Number(base.holdMin / 10n ** COIN_DECIMALS), rules7From: Number.isFinite(base.rules7From) ? iso(base.rules7From) : null, holdWaitH: Math.round(base.holdWait / 3600_000) };
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
