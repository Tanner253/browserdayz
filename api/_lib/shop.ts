// The store's money (2026-10-22): a price quoted in SOL, the payment found on chain and checked, and the book of what was
// bought. Nothing here sends anything: every question put to the chain is a read.
//
// No wallet is connected (the owner: "there is no wallet connect or anything so well have to ask the user to validate
// the payment some how and well have to validate it somehow"). So a quote is sealed to the player's account and carries
// two marks of its own: an amount whose last digits are that quote's, and a Solana Pay reference (a key a wallet that
// scans the code puts in the payment). A payment is found by either, or by the signature the player pastes, and goes to
// the account the quote was made for, never to whoever asks: whoever watches the store's wallet sees every payment and
// can claim none of them.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { b58, type Rpc } from './solana.js';
import type { Store } from './store.js';
import { CUP_DAYS, QUOTE_MS, SHOP, isAcct, isItem, type ItemId, type PerkList, type Perks } from './shop-items.js';

export const BOOK = 'store/book.json';
const DAY = 86_400_000;
/** a payment may be stamped this much before its quote (the chain's clock and ours) */
const SKEW = 120_000;
/** and is still on time this long after the quote's half hour (a wallet that took a while) */
const GRACE = 10 * 60_000;

export interface Quote {
  item: ItemId;
  acct: string;
  usd: number;
  /** dollars a SOL */
  rate: number;
  lamports: number;
  t: number;
}

export interface Row {
  id: string;
  /** the payment's signature ('' for one given by hand) */
  sig: string;
  item: ItemId;
  acct: string;
  /** the player's name as their menu had it: for reading only */
  name: string;
  usd: number;
  rate: number;
  /** what was asked and what came, lamports */
  quoted: number;
  paid: number;
  /** the paying wallet (the transaction's fee payer) */
  from: string;
  /** when it landed on chain, ms (for one given by hand: when it was given) */
  paidAt: number;
  /** when it was claimed */
  at: string;
  how: 'ref' | 'amount' | 'sig' | 'hand';
  status: 'ok' | 'look' | 'revoked' | 'refunded';
  why?: string;
  days?: number;
  discord?: string;
  note?: string;
  /** the Discord role has been given (an admin ticks it) */
  role?: boolean;
  /** the last admin to act on it */
  by?: string;
  /** the account it was moved from */
  moved?: string;
  /** a finish's own number among those sold of it (1 to its limit): kept for each, to be minted as its own later */
  serial?: number;
}

export interface Book {
  rows: Row[];
}

// ------------------------------------------------------------------ quotes

const mac = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest();

/** what quotes are sealed with: drawn from the admin password as the admin file's pepper is (api/admin.ts), never the password */
export const sealOf = (password: string) => createHmac('sha256', password).update('zona store quotes').digest('hex');

export function seal(secret: string, q: Quote): string {
  const body = Buffer.from(JSON.stringify(q)).toString('base64url');
  return `${body}.${mac(secret, body).toString('base64url').slice(0, 32)}`;
}

export function unseal(secret: string, token: unknown): Quote | null {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [body, tag] = token.split('.');
  if (!body || !tag) return null;
  const want = Buffer.from(mac(secret, body).toString('base64url').slice(0, 32)), got = Buffer.from(tag);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const q = JSON.parse(Buffer.from(body, 'base64url').toString()) as Quote;
    return isItem(q.item) && isAcct(q.acct) && q.lamports > 0 && q.rate > 0 && q.t > 0 ? q : null;
  } catch {
    return null;
  }
}

/** the quote's Solana Pay reference: 32 bytes of its own, which a wallet that scans the code puts in the payment */
export const referenceOf = (secret: string, token: string) => b58(mac(secret, `reference ${token}`).subarray(0, 32));

/** The price in SOL, rounded up to a hundred-thousandth, and the last four digits of the nine the quote's own. */
export function makeQuote(secret: string, item: ItemId, acct: string, usd: number, rate: number, now: number): Quote {
  const base = Math.ceil((usd / rate) * 1e5) * 1e4;
  const tail = (mac(secret, `tail ${acct} ${item} ${now}`).readUInt32BE(0) % 9000) + 1000;
  return { item, acct, usd, rate, lamports: base + tail, t: now };
}

/** lamports as SOL with all nine places, written out exactly */
export function sol(lamports: number): string {
  const s = String(Math.max(0, Math.round(lamports))).padStart(10, '0');
  return `${s.slice(0, -9)}.${s.slice(-9)}`;
}

export const payUrl = (wallet: string, q: Quote, reference: string) =>
  `solana:${wallet}?amount=${sol(q.lamports)}&reference=${reference}&label=ZONA&message=${encodeURIComponent(SHOP[q.item].name)}`;

// ------------------------------------------------------------------ the price of a SOL

const WSOL = 'So11111111111111111111111111111111111111112';
let held: { rate: number; at: number } | null = null;

/** Dollars a SOL: Jupiter's free price feed, CoinGecko's if it does not answer. Held a minute. */
export async function solUsd(get: typeof fetch = fetch, now = Date.now()): Promise<number> {
  if (held && now - held.at < 60_000) return held.rate;
  const signal = () => AbortSignal.timeout(6000);
  const feeds = [
    async () => ((await (await get(`https://lite-api.jup.ag/price/v3?ids=${WSOL}`, { signal: signal() })).json()) as Record<string, { usdPrice?: number }>)[WSOL]?.usdPrice,
    async () => ((await (await get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: signal() })).json()) as { solana?: { usd?: number } }).solana?.usd,
  ];
  for (const feed of feeds) {
    const rate = Number(await feed().catch(() => NaN));
    // (a price no feed could mean is no price)
    if (rate > 1 && rate < 100_000) return (held = { rate, at: now }).rate;
  }
  throw new Error('no price for SOL could be had');
}

// ------------------------------------------------------------------ finding the payment

export interface Paid {
  sig: string;
  /** what the store's wallet gained by it, lamports */
  gained: number;
  from: string;
  /** when it landed, ms (0: the node did not say) */
  at: number;
}

type TxJson = {
  blockTime: number | null;
  transaction: { message: { accountKeys: string[] } };
  meta: { err: unknown; preBalances: number[]; postBalances: number[]; loadedAddresses?: { writable: string[]; readonly: string[] } } | null;
} | null;

export const isSig = (v: unknown): v is string => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(v);

/** What a transaction that went through brought the wallet, read off the transaction itself (its looked-up accounts too). */
export async function paymentOf(rpc: Rpc, sig: string, wallet: string): Promise<Paid | null> {
  const r = await rpc.call<TxJson>('getTransaction', [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  if (!r?.meta || r.meta.err) return null;
  const keys = [...r.transaction.message.accountKeys, ...(r.meta.loadedAddresses?.writable ?? []), ...(r.meta.loadedAddresses?.readonly ?? [])];
  const i = keys.indexOf(wallet);
  if (i < 0) return null;
  return { sig, gained: r.meta.postBalances[i] - r.meta.preBalances[i], from: keys[0], at: (r.blockTime ?? 0) * 1000 };
}

type SigInfo = { signature: string; blockTime: number | null; err: unknown };
const signaturesOf = (rpc: Rpc, who: string, limit: number) => rpc.call<SigInfo[]>('getSignaturesForAddress', [who, { limit, commitment: 'confirmed' }]);

/**
 * The payment for a quote: the signature pasted, else whatever carries the quote's reference, else, among the wallet's
 * newest that landed after the quote, the one of exactly its amount. None already in the book.
 */
export async function findPayment(rpc: Rpc, wallet: string, q: Quote, reference: string, used: Set<string>, pasted?: string): Promise<{ p: Paid; how: Row['how'] } | null> {
  const fresh = (s: SigInfo) => !s.err && !used.has(s.signature);
  if (pasted) {
    const p = await paymentOf(rpc, pasted, wallet);
    return p && p.gained > 0 ? { p, how: 'sig' } : null;
  }
  for (const s of (await signaturesOf(rpc, reference, 10)).filter(fresh)) {
    const p = await paymentOf(rpc, s.signature, wallet);
    if (p && p.gained > 0) return { p, how: 'ref' };
  }
  const after = (await signaturesOf(rpc, wallet, 40)).filter((s) => fresh(s) && (s.blockTime ?? 0) * 1000 >= q.t - SKEW).slice(0, 30);
  for (let i = 0; i < after.length; i += 6) {
    const some = await Promise.all(after.slice(i, i + 6).map((s) => paymentOf(rpc, s.signature, wallet).catch(() => null)));
    const hit = some.find((p) => p && p.gained === q.lamports);
    if (hit) return { p: hit, how: 'amount' };
  }
  return null;
}

/**
 * What becomes of a payment found for a quote. On time and enough: granted. Short, or late: kept for an admin to look
 * at. Under half, or made before the quote: refused and not written (each written row is one of the store's writes,
 * and a payment of a lamport costs nobody anything).
 */
export function judge(q: Quote, p: Paid): { status: 'ok' | 'look'; why?: string } | { refuse: string } {
  if (p.at && p.at < q.t - SKEW) return { refuse: 'That payment was made before this quote. Ask on Discord if it was for the store.' };
  if (p.gained * 2 < q.lamports) return { refuse: `That payment brought ${sol(p.gained)} SOL, under half of the ${sol(q.lamports)} asked. Ask on Discord.` };
  if (p.gained < q.lamports) return { status: 'look', why: `short: ${sol(p.gained)} of ${sol(q.lamports)} SOL` };
  if (!p.at || p.at > q.t + QUOTE_MS + GRACE) return { status: 'look', why: 'paid after the quote ran out' };
  return { status: 'ok' };
}

// ------------------------------------------------------------------ numbered finishes

/** a purchase that holds its number: granted, or paid and waiting for an admin's look */
const holds = (r: Row) => r.status === 'ok' || r.status === 'look';

/** how many of each limited finish are left to sell */
export function stockOf(book: Book | null): Partial<Record<ItemId, number>> {
  const out: Partial<Record<ItemId, number>> = {};
  for (const id of Object.keys(SHOP) as ItemId[]) {
    const limit = SHOP[id].limit;
    if (limit) out[id] = Math.max(0, limit - (book?.rows ?? []).filter((r) => r.item === id && holds(r) && r.serial).length);
  }
  return out;
}

/** the lowest number of a finish nobody holds (one refunded or revoked is free again), or null when all are held */
export function freeSerial(book: Book, item: ItemId, except?: Row): number | null {
  const taken = new Set(book.rows.filter((r) => r !== except && r.item === item && holds(r) && r.serial).map((r) => r.serial));
  const limit = SHOP[item].limit ?? Infinity;
  for (let n = 1; n <= limit; n++) if (!taken.has(n)) return n;
  return null;
}

/** whether an account holds a finish already (bought once, it is theirs: a second would be money for nothing) */
export const owns = (book: Book | null, acct: string, item: ItemId) => (book?.rows ?? []).some((r) => r.acct === acct && r.item === item && holds(r));

/**
 * A finish being booked takes its number; sold out, or owned already, it is kept for an admin to refund (a race for
 * the last one, between two quotes, is lost by whoever paid second). Changes the row.
 */
export function number(book: Book, r: Row): void {
  if (!SHOP[r.item].skin || !holds(r)) return;
  if (book.rows.some((o) => o !== r && o.acct === r.acct && o.item === r.item && holds(o))) {
    r.status = 'look';
    r.why = 'owned already: refund it';
    delete r.serial;
    return;
  }
  const n = freeSerial(book, r.item, r);
  if (n === null) {
    r.status = 'look';
    r.why = `sold out (all ${SHOP[r.item].limit}): refund it`;
    delete r.serial;
  } else r.serial = n;
}

// ------------------------------------------------------------------ the book

export const rowId = (seed: string) => createHash('sha256').update(seed || randomBytes(16)).digest('hex').slice(0, 10);

/** Every account's perks from the rows that stand: each month of VIP or no-ads added to what was left of it. */
export function perksFrom(rows: readonly Row[], now = Date.now()): Map<string, Perks> {
  const all = new Map<string, Perks>();
  for (const r of rows.filter((r) => r.status === 'ok').sort((a, b) => a.paidAt - b.paidAt)) {
    let p = all.get(r.acct);
    if (!p) all.set(r.acct, (p = { vip: 0, noads: 0, cup: 0, skins: [] }));
    const it = SHOP[r.item];
    if (r.item === 'vip' || r.item === 'noads') p[r.item] = Math.max(p[r.item], r.paidAt) + (r.days ?? it.days ?? 30) * DAY;
    else if (r.item === 'coffee') p.cup = Math.max(p.cup, r.paidAt + CUP_DAYS * DAY);
    else if (it.skin && !p.skins.includes(r.item)) p.skins.push(r.item);
  }
  for (const [a, p] of all) if (p.vip <= now && p.noads <= now && p.cup <= now && !p.skins.length) all.delete(a);
  return all;
}

export function perkList(book: Book | null, now = Date.now()): PerkList {
  const who: PerkList['who'] = {};
  for (const [a, p] of perksFrom(book?.rows ?? [], now)) who[a] = [p.vip, p.noads, p.cup, p.skins];
  return { at: now, who };
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * One change to the book: read, changed, written only if nobody wrote it in between (else read again). `change` says
 * why not, or nothing. One write, and only when there is something to write.
 */
export async function writeBook(store: Store, change: (b: Book) => string | null, wait = sleep): Promise<{ ok: true; book: Book } | { ok: false; why: string }> {
  for (let i = 0; i < 4; i++) {
    let now: { data: Book; mark: string } | null;
    try {
      now = await store.read<Book>(BOOK);
    } catch {
      // (the store serves an old copy for a while after a write: store.ts)
      await wait(500 * (i + 1));
      continue;
    }
    const book: Book = { rows: Array.isArray(now?.data?.rows) ? now.data.rows : [] };
    const why = change(book);
    if (why) return { ok: false, why };
    if ((await store.swap(BOOK, book, now?.mark ?? null)) !== false) return { ok: true, book };
    await wait(300 * (i + 1));
  }
  return { ok: false, why: 'The store was busy: try again in a moment.' };
}

// ------------------------------------------------------------------ an admin's hand

export type AdminAct =
  | { act: 'list' }
  | { act: 'grant'; acct: string; item: ItemId; days?: number; note?: string; name?: string }
  | { act: 'set'; id: string; status: 'ok' | 'revoked' | 'refunded' }
  | { act: 'move'; id: string; acct: string }
  | { act: 'role'; id: string; on: boolean }
  | { act: 'end'; acct: string; item: ItemId };

const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

/** what an admin's order is taken as: nothing but its parts, each sane */
export function adminAct(v: unknown): AdminAct | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const id = /^[0-9a-f]{10}$/.test(String(o.id)) ? String(o.id) : '';
  switch (o.act) {
    case 'list':
      return { act: 'list' };
    case 'grant': {
      const days = Math.round(Number(o.days));
      return isAcct(o.acct) && isItem(o.item) ? { act: 'grant', acct: o.acct, item: o.item, ...(days > 0 && days <= 3650 ? { days } : {}), note: text(o.note, 120), name: text(o.name, 24) } : null;
    }
    case 'set':
      return id && (o.status === 'ok' || o.status === 'revoked' || o.status === 'refunded') ? { act: 'set', id, status: o.status } : null;
    case 'move':
      return id && isAcct(o.acct) ? { act: 'move', id, acct: o.acct } : null;
    case 'role':
      return id ? { act: 'role', id, on: !!o.on } : null;
    case 'end':
      return isAcct(o.acct) && isItem(o.item) ? { act: 'end', acct: o.acct, item: o.item } : null;
  }
  return null;
}

/** An admin's change to the book, or why it cannot be made. */
export function applyAct(book: Book, a: Exclude<AdminAct, { act: 'list' }>, by: string, now: number): string | null {
  if (a.act === 'grant') {
    const it = SHOP[a.item];
    if (it.skin && owns(book, a.acct, a.item)) return 'They have that already.';
    if (it.skin && freeSerial(book, a.item) === null) return `Sold out: all ${it.limit} are held.`;
    const r: Row = {
      id: rowId(''), sig: '', item: a.item, acct: a.acct, name: a.name ?? '', usd: 0, rate: 0, quoted: 0, paid: 0, from: '', paidAt: now,
      at: new Date(now).toISOString(), how: 'hand', status: 'ok', ...(it.days ? { days: a.days ?? it.days } : {}), ...(a.note ? { note: a.note } : {}), by,
    };
    book.rows.push(r);
    number(book, r);
    return null;
  }
  if (a.act === 'end') {
    // (every purchase of it by that account that stands, taken back at once: VIP ended, a finish taken away)
    const theirs = book.rows.filter((x) => x.acct === a.acct && x.item === a.item && x.status === 'ok');
    if (!theirs.length) return 'They have none of that now.';
    for (const x of theirs) Object.assign(x, { status: 'revoked', by });
    return null;
  }
  const r = book.rows.find((x) => x.id === a.id);
  if (!r) return 'No such purchase.';
  if (a.act === 'set') {
    const was = r.status, mine = r.serial;
    r.status = a.status;
    delete r.why;
    // (passed or restored: a finish takes a number again, its own if nobody has been given it meanwhile)
    if (SHOP[r.item].skin && a.status === 'ok' && (was !== 'ok' || !r.serial)) {
      const free = !!mine && !book.rows.some((o) => o !== r && o.item === r.item && holds(o) && o.serial === mine);
      number(book, r);
      if (r.status !== 'ok') return r.why ?? 'It cannot be passed.';
      if (free) r.serial = mine;
    }
  } else if (a.act === 'move') {
    if (a.acct === r.acct) return 'It is that account already.';
    r.moved = r.acct;
    r.acct = a.acct;
  } else r.role = a.on;
  r.by = by;
  return null;
}

/** For the admin's STORE tab: the newest rows, what came in, and the VIPs that run out soonest. */
export function adminView(book: Book | null, now = Date.now()) {
  const rows = [...(book?.rows ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const month = new Date(now).toISOString().slice(0, 7);
  const sum = (rs: Row[]) => ({ n: rs.length, usd: Math.round(rs.reduce((s, r) => s + r.usd, 0) * 100) / 100, sol: sol(rs.reduce((s, r) => s + r.paid, 0)) });
  const paid = rows.filter((r) => r.status === 'ok' && r.how !== 'hand');
  const perks = perksFrom(rows, now);
  const vips = [...perks].filter(([, p]) => p.vip > now).map(([acct, p]) => {
    // (the newest of their VIP rows that gave a Discord name: a month bought again may give none)
    const theirs = rows.filter((r) => r.acct === acct && r.item === 'vip'), last = theirs.find((r) => r.discord) ?? theirs[0];
    return { acct, until: p.vip, name: theirs.find((r) => r.name)?.name ?? '', discord: last?.discord ?? '', role: !!last?.role, id: last?.id ?? '' };
  }).sort((a, b) => a.until - b.until);
  // (every account that ever bought or was given anything: what it has now, what it paid, how to reach it)
  const people = new Map<string, { acct: string; name: string; discord: string; usd: number; n: number; looks: number; last: string; vip: number; noads: number; cup: number; owned: { item: ItemId; serial?: number; id: string }[] }>();
  for (const r of rows) {
    let p = people.get(r.acct);
    if (!p) people.set(r.acct, (p = { acct: r.acct, name: '', discord: '', usd: 0, n: 0, looks: 0, last: r.at, vip: 0, noads: 0, cup: 0, owned: [] }));
    p.name ||= r.name;
    p.discord ||= r.discord ?? '';
    p.n++;
    if (r.status === 'ok' && r.how !== 'hand') p.usd = Math.round((p.usd + r.usd) * 100) / 100;
    if (r.status === 'look') p.looks++;
    if (r.status === 'ok' && SHOP[r.item].skin) p.owned.push({ item: r.item, ...(r.serial ? { serial: r.serial } : {}), id: r.id });
  }
  for (const [acct, k] of perks) Object.assign(people.get(acct) ?? {}, { vip: k.vip, noads: k.noads, cup: k.cup });
  return { rows: rows.slice(0, 300), month: sum(paid.filter((r) => r.at.startsWith(month))), all: sum(paid), looks: rows.filter((r) => r.status === 'look').length, vips, players: [...people.values()] };
}

