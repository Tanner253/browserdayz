// An admin's orders to the store's book (2026-10-22), from the STORE tab of their panel (src/ui/admin-store.ts): passed
// to the site, which keeps the book (api/store.ts), proved as the admin lists are (api/admin.ts): the site is told a
// number and asks this server back what it stands for. Admins only: a mod sees no money.

import { randomBytes } from 'node:crypto';
import { ADMIN, roleOf } from './gate';
import { acctOf, perks, storeUrl } from './perks';
import { clients, send, type Client } from './players';
import { scores } from './queue';

/**
 * Players this server knows by name, for a gift to somebody who has bought nothing yet: who is on now, who left a while
 * ago, and whoever is on the board since the server started. Each by the account the store keeps things under, which
 * only this server can make (it holds their keys).
 */
function known(q: string) {
  const out = new Map<string, { name: string; acct: string; online: boolean }>();
  const add = (name: string, key: string, online: boolean) => {
    if (!key || out.size >= 12 || (q && !name.toLowerCase().includes(q))) return;
    const acct = acctOf(key), had = out.get(acct);
    if (!had || (online && !had.online)) out.set(acct, { name, acct, online });
  };
  for (const o of clients.values()) add(o.name, o.key, true);
  for (const g of [...ADMIN.gone].reverse()) add(g.name, g.key, false);
  for (const [key, s] of scores) add(s.name, key, false);
  return [...out.values()];
}

export async function storeOrder(c: Client, act: unknown) {
  if (roleOf(c) !== 'admin') return;
  // (a search for players, answered here: the site knows only who has bought)
  if ((act as { act?: string })?.act === 'who') return void send(c, { t: 'store', ok: true, who: known(String((act as { q?: unknown }).q ?? '').toLowerCase().trim().slice(0, 24)) });
  // (a player online named by their number, #12, is given by their account: the hash of their key, which only this server knows)
  const o = (act ?? {}) as { acct?: unknown };
  if (typeof o.acct === 'string' && /^#\d+$/.test(o.acct)) {
    const who = clients.get(Number(o.acct.slice(1)));
    if (!who) return void send(c, { t: 'store', ok: false, why: `Nobody is ${o.acct} on this server.` });
    act = { ...o, acct: acctOf(who.key), name: who.name };
  }
  const n = randomBytes(16).toString('hex');
  ADMIN.ops.set(n, { op: 'store', act, by: c.name });
  try {
    const r = await fetch(`${storeUrl()}/api/store?n=${n}`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
    const out = (await r.json().catch(() => ({}))) as { ok?: boolean; view?: unknown; why?: string; error?: string };
    send(c, { t: 'store', ok: !!out.ok, ...(out.view ? { view: out.view } : {}), ...(out.ok ? {} : { why: out.why ?? out.error ?? `The site answered ${r.status}.` }) });
    // (a grant, a refund or a move changes who has what: asked again, so it shows in the game within a minute)
    if (out.ok && (act as { act?: string })?.act !== 'list') perks.bought();
  } catch {
    send(c, { t: 'store', ok: false, why: 'The site did not answer: try again in a minute.' });
  } finally {
    ADMIN.ops.delete(n);
  }
}
