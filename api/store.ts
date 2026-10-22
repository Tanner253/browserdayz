// The store (2026-10-22): its prices quoted in SOL, payments checked on chain, and who has what. The owner: "payments from
// these sources will go to a public wallet address ill put in the server ENV. well need to log these payments in some
// sort of database and in the amdin ui so i can see and validate these things". The wallet is STORE_WALLET in this
// site's settings; the book is one file beside the payouts' (store/book.json), written once a purchase and once an
// admin's change, never otherwise (the Blob store's writes are counted: _lib/store.ts).
//
//   GET  ?perks=1            who has what, for the game servers (from the cache)
//   GET  ?acct=<24 hex>      one account's perks and purchases, for its store page
//   POST {op:'quote', item, acct, usd?}           a price in SOL, held half an hour
//   POST {op:'claim', token, sig?, name?, discord?, note?}   find the payment and book it
//   POST ?n=<number>         an admin's order, proved as api/admin.ts's are: the game server says what the number is

import { Rpc, address } from './_lib/solana.js';
import { blobStore, type Store } from './_lib/store.js';
import { BOOK, adminAct, adminView, applyAct, findPayment, isSig, judge, makeQuote, payUrl, perkList, perksFrom, referenceOf, rowId, seal, sealOf, sol, solUsd, unseal, writeBook, type Book, type Row } from './_lib/shop.js';
import { COFFEE, NO_PERKS, QUOTE_MS, SHOP, isAcct, isItem } from './_lib/shop-items.js';

export interface Deps {
  store: Store;
  rpc: Rpc;
  env: Record<string, string | undefined>;
  /** the game server an admin's order is asked of */
  game: string;
  now: () => number;
  rate: () => Promise<number>;
}

const json = (body: unknown, status = 200, cache = 'no-store') => Response.json(body, { status, headers: { 'cache-control': cache } });
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

/** claims a minute from one address: each is several questions put to the chain */
const asked = new Map<string, number[]>();
function tooMany(ip: string, now: number) {
  const t = (asked.get(ip) ?? []).filter((x) => now - x < 60_000);
  t.push(now);
  asked.set(ip, t);
  if (asked.size > 5000) asked.clear();
  return t.length > 12;
}

export async function storeApi(request: Request, d: Partial<Deps> = {}): Promise<Response> {
  const env = d.env ?? process.env;
  const store = d.store ?? blobStore;
  const now = (d.now ?? Date.now)();
  const url = new URL(request.url);
  const wallet = (env.STORE_WALLET ?? '').trim();
  const open = (() => {
    try {
      return !!wallet && !!address(wallet);
    } catch {
      return false;
    }
  })();
  // (quotes are sealed with a secret drawn from the admin password; a desk with no password has one of its own)
  const secret = env.ADMIN_PASSWORD ? sealOf(env.ADMIN_PASSWORD) : env.VERCEL ? '' : 'zona store at a desk';

  if (request.method === 'GET') {
    if (url.searchParams.has('perks')) return json(perkList(await store.glance<Book>(BOOK), now), 200, 'public, max-age=0, s-maxage=30');
    const acct = url.searchParams.get('acct');
    if (!isAcct(acct)) return json({ error: 'which account?' }, 400);
    const book = await store.glance<Book>(BOOK);
    const mine = (book?.rows ?? []).filter((r) => r.acct === acct).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
    return json({ open, perks: perksFrom(mine, now).get(acct) ?? NO_PERKS, rows: mine.map((r) => ({ id: r.id, item: r.item, at: r.at, status: r.status, sig: r.sig, sol: sol(r.paid), usd: r.usd })) }, 200, 'public, max-age=0, s-maxage=10');
  }
  if (request.method !== 'POST') return json({ error: 'GET or POST' }, 405);

  const n = url.searchParams.get('n');
  if (n !== null) return admin(n, store, d.game ?? env.GAME_SERVER_URL ?? 'https://browserdayz.onrender.com', now);

  if (!open || !secret) return json({ ok: false, why: 'The store is not open yet.' }, 503);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.op === 'quote') {
    if (!isItem(body.item) || !isAcct(body.acct)) return json({ ok: false, why: 'What, and for whom?' }, 400);
    const usd = body.item === 'coffee' ? Math.round(Math.min(COFFEE.max, Math.max(COFFEE.min, Number(body.usd) || 0)) * 100) / 100 : SHOP[body.item].usd;
    const rate = await (d.rate ?? solUsd)().catch(() => 0);
    if (!rate) return json({ ok: false, why: 'The price of SOL could not be had: try again in a minute.' }, 503);
    const q = makeQuote(secret, body.item, body.acct, usd, rate, now);
    const token = seal(secret, q), reference = referenceOf(secret, token);
    return json({ ok: true, token, item: q.item, usd, rate, lamports: q.lamports, sol: sol(q.lamports), wallet, reference, url: payUrl(wallet, q, reference), until: q.t + QUOTE_MS });
  }

  if (body.op === 'claim') {
    const q = unseal(secret, body.token);
    if (!q) return json({ ok: false, why: 'That quote is not one of ours: get a new one.' }, 400);
    const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    if (tooMany(ip, now)) return json({ ok: false, why: 'Too many tries: wait a minute.' }, 429);
    const pasted = body.sig === undefined || body.sig === '' ? undefined : isSig(body.sig) ? body.sig : null;
    if (pasted === null) return json({ ok: false, why: 'That is not a transaction signature.' }, 400);
    const used = new Set(((await store.glance<Book>(BOOK))?.rows ?? []).map((r) => r.sig).filter(Boolean));
    if (pasted && used.has(pasted)) return json({ ok: false, why: 'That payment has been used already.' });
    const rpc = d.rpc ?? new Rpc(env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com');
    const found = await findPayment(rpc, wallet, q, referenceOf(secret, body.token as string), used, pasted).catch(() => undefined);
    if (found === undefined) return json({ ok: false, wait: true, why: 'The chain could not be read just now: try again in a moment.' });
    if (!found) return json({ ok: false, wait: true, why: pasted ? 'That transaction brought nothing to the store’s wallet.' : 'No payment found yet. A payment takes a few seconds to land: try again, or paste its signature.' });
    const verdict = judge(q, found.p);
    if ('refuse' in verdict) return json({ ok: false, why: verdict.refuse });
    const row: Row = {
      id: rowId(found.p.sig), sig: found.p.sig, item: q.item, acct: q.acct, name: text(body.name, 24), usd: q.usd, rate: q.rate, quoted: q.lamports,
      paid: found.p.gained, from: found.p.from, paidAt: found.p.at || now, at: new Date(now).toISOString(), how: found.how, status: verdict.status,
      ...(verdict.why ? { why: verdict.why } : {}),
      ...(q.item === 'vip' && text(body.discord, 40) ? { discord: text(body.discord, 40) } : {}),
      ...(q.item === 'coffee' && text(body.note, 120) ? { note: text(body.note, 120) } : {}),
    };
    const made = await writeBook(store, (b) => (b.rows.some((r) => r.sig === row.sig) ? 'That payment has been used already.' : (b.rows.push(row), null)));
    if (!made.ok) return json({ ok: false, why: made.why });
    return json({ ok: true, status: row.status, why: row.why, id: row.id, sig: row.sig, perks: perksFrom(made.book.rows.filter((r) => r.acct === q.acct), now).get(q.acct) ?? NO_PERKS });
  }
  return json({ ok: false, why: 'no such thing to do' }, 400);
}

/** An admin's order: the game server is asked what the number stands for, and makes up such numbers for admins only. */
async function admin(n: string, store: Store, game: string, now: number): Promise<Response> {
  if (!/^[a-f0-9]{32}$/.test(n)) return json({ error: 'bad number' }, 400);
  const r = await fetch(`${game}/adminop/${n}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r || !r.ok) return json({ error: 'the game server does not know that number' }, 404);
  const op = (await r.json()) as { op?: string; act?: unknown; by?: unknown };
  const act = op.op === 'store' ? adminAct(op.act) : null;
  if (!act) return json({ error: 'no such thing to do' }, 400);
  if (act.act === 'list') {
    const held = await store.read<Book>(BOOK).catch(() => null);
    return json({ ok: true, view: adminView(held?.data ?? (await store.glance<Book>(BOOK)), now) });
  }
  const made = await writeBook(store, (b) => applyAct(b, act, text(op.by, 24), now));
  return json(made.ok ? { ok: true, view: adminView(made.book, now) } : { ok: false, why: made.why });
}

export const GET = (request: Request) => storeApi(request);
export const POST = (request: Request) => storeApi(request);
