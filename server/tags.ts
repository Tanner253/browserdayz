// The server: cashed-in dog tags, who looted whose, and what a tag must have lived through to pay.
// (One part of index.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { SerializedInventory } from '../src/sim/inventory';
import { TAG_HOLD, TAG_FRESH, type ItemInstance } from '../src/sim/items';
import { paced, type Hits } from '../src/sim/hitclock';
import { log } from './index';
import { clients, send, type Client } from './players';
import { scoreOf, sendBoard } from './queue';
import { elite } from './elite';
import { KEPT } from './keep';

// ------------------------------------------------------------------ cashed-in tags
//
// A tag counts for a reward only if this server watched it happen: the tag came off a body
// the server itself made when its owner died, somebody else has carried it, and the hold
// time (TAG_HOLD, fifteen minutes) of the server's own clock has passed since the server first
// saw it in their pockets. What a client says about its own inventory is not enough.

/** the website keeps the list (this server has no disk): it is told the id and asks back for the entry */
export const SITE_URL = process.env.SITE_URL ?? 'https://www.zonapvp.fun';

/** seconds a tag must be seen carried; a minute of slack for the gap between a client's reports */
export const CASH_HOLD_MS = (Number(process.env.CASH_HOLD_S) || TAG_HOLD - 60) * 1000;

interface CashIn {
  id: string;
  at: string;
  name: string;
  owner: string;
  wallet: string;
}

export const cashins: CashIn[] = [];

/** a tag taken off a body this server made: whose it was, where they were playing from, and how long that life had lasted */
interface Looted {
  owner: string;
  ownerKey: string;
  ownerIp: string;
  livedMs: number;
}

/** tag uid -> that */
export const lootedTags = new Map<string, Looted>();

/** tags carried out of the Zona and held there past TAG_OUT: no reward is ever paid on one */
export const voided = new Set<string>();

/** `${player key}|${tag uid}` -> when the server first saw that player carrying it */
export const tagSeen = new Map<string, number>();

export const isWallet = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

// Tags are paid for in SOL now (the site does it: api/_lib/payouts.ts), and the cheapest way
// to a tag is a second window of one's own. So a tag is listed for a reward only if, as well
// as having been taken and held under this server's eyes: its owner was not playing from the
// same connection as whoever cashes it in; its owner had been alive a couple of minutes (a
// body that only exists to be killed again is worth nothing); and the same two players have
// not just done this. None of it stops two people in two houses who are set on it: what the
// site will pay in a day, and to one wallet, is what bounds that.
const TAG_MIN_LIFE_MS = (Number(process.env.TAG_MIN_LIFE_S) || 120) * 1000;

/** and there is no tag on a body at all until its owner had lived this long (see TAG_FRESH) */
export const TAG_FRESH_MS = (Number(process.env.TAG_FRESH_S) || TAG_FRESH) * 1000;

const TAG_PAIR_GAP_MS = (Number(process.env.TAG_PAIR_GAP_S) || 3 * 3600) * 1000;

/** `${who cashed in}>${whose tag}` (each a player's key, or "ip:" and where they play from) -> when */
export const pairPaidAt = new Map<string, number>();

/** where a connection comes from, as near as the host lets it be known */
export function addressOf(req: http.IncomingMessage): string {
  const first = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? '').split(',')[0].trim();
  return netOf(first(req.headers['cf-connecting-ip']) || first(req.headers['true-client-ip']) || first(req.headers['x-forwarded-for']) || req.socket.remoteAddress || '');
}

/**
 * An address as far as it says whose connection it is. One of the old kind is that; one of the new kind (with
 * colons) is a different number for every device and every day, and it is the first half of it that is the
 * household's: that half is what is kept, so that a ban of an address, and one player to an address, mean on
 * the new kind what they mean on the old.
 */
function netOf(ip: string): string {
  if (!ip.includes(':') || ip === '::1') return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export const ipOf = new WeakMap<WebSocket, string>();

/** addresses only mean something while they tell players apart: if three or more are on and all seem to come from one place, the host is hiding them */
export const ipsTellApart = () => clients.size < 3 || new Set([...clients.values()].map((x) => x.ip)).size > 1;

/** the names a player goes by here: their key, (when it means anything) where they play from, and (when it was said) the device they play on */
export const namesOf = (key: string, ip: string, fp = '') => [key, ...(ip && ipsTellApart() ? [`ip:${ip}`] : []), ...(fp ? [`fp:${fp}`] : [])];

/** Why a tag earns nothing, or null if it does. */
export function notEarned(c: Client, from: Looted, since: number | undefined, now: number): string | null {
  if (from.ownerKey === c.key) return 'it is your own';
  if (since === undefined || now - since < CASH_HOLD_MS) return 'it was not held for the full time';
  if (c.ip && from.ownerIp === c.ip && ipsTellApart()) return 'its owner was playing from the same connection as you';
  if (from.livedMs < TAG_MIN_LIFE_MS) return `its owner had been alive for less than ${TAG_MIN_LIFE_MS >= 60000 ? `${Math.round(TAG_MIN_LIFE_MS / 60000)} minutes` : `${Math.round(TAG_MIN_LIFE_MS / 1000)} seconds`}`;
  const theirs = namesOf(from.ownerKey, from.ownerIp);
  if (namesOf(c.key, c.ip).some((a) => theirs.some((b) => now - (pairPaidAt.get(`${a}>${b}`) ?? -Infinity) < TAG_PAIR_GAP_MS))) return `you cashed in another of their tags less than ${Math.round(TAG_PAIR_GAP_MS / 3600000)} hours ago`;
  return null;
}

export function recordCashIn(c: Client, owner: string, wallet: string) {
  // (its id is what the site is called with, and what the receipt of its payment is made from: not to be guessed)
  const entry: CashIn = { id: randomBytes(16).toString('hex'), at: new Date().toISOString(), name: c.name, owner, wallet };
  cashins.push(entry);
  if (cashins.length > 2000) cashins.shift();
  scoreOf(c).tags++;
  sendBoard();
  // also in the server's own log, which the host keeps for a few days whatever else happens
  log('CASHIN', JSON.stringify(entry));
  follow(entry, c.key, 1, Date.now());
}

/** what the site answers about a tag (see Outcome in api/_lib/payouts.ts) */
interface SitePayout {
  state: 'paid' | 'sending' | 'waiting' | 'skipped' | 'off';
  lamports?: number;
  signature?: string;
  why?: string;
}

/**
 * Hands a cash-in to the site, which lists it and pays it, and tells the player what became
 * of it. A tag the site has not settled (the payment is on its way, the treasury is empty,
 * the day's limit is reached) is asked about again, for up to a day: the site also looks at
 * such tags itself once a day, so one this server forgets in a restart is not lost.
 */
function follow(entry: CashIn, key: string, attempt: number, began: number) {
  const again = (ms: number) => void setTimeout(() => follow(entry, key, attempt + 1, began), ms).unref();
  const say = (kind: 'good' | 'warn' | 'info', text: string) => {
    const who = [...clients.values()].find((x) => x.key === key);
    if (who) send(who, { t: 'tell', kind, text });
  };
  fetch(`${SITE_URL}/api/cashin?id=${entry.id}`, { method: 'POST', signal: AbortSignal.timeout(75_000) })
    .then(async (r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      const said = (await r.json()) as { payout?: SitePayout; top?: boolean }, p = said.payout;
      // (payouts not switched on: it is listed, and that is all)
      if (!p || p.state === 'off') return;
      if (p.state === 'paid') {
        log('PAID', entry.id, p.signature);
        // (paid at the top rate, their name has the Elite's crown in chat; paid less, it has not: see elite.ts)
        if (!!said.top !== elite.has(key)) {
          elite.paid(key, !!said.top);
          KEPT.dirty = true;
        }
        say('good', `${Math.round((p.lamports ?? 0) / 1e5) / 1e4} SOL sent to ${entry.wallet.slice(0, 4)}…${entry.wallet.slice(-4)} for ${entry.owner}'s tag.`);
        // with this one seen to, the site collects its rewards if there are any and looks at whatever else is waiting
        fetch(`${SITE_URL}/api/tick`, { signal: AbortSignal.timeout(75_000) }).catch(() => {});
        return;
      }
      if (p.state === 'skipped') {
        log('NOT PAID', entry.id, p.why);
        say('warn', `${entry.owner}'s tag is listed and not paid: ${p.why}.`);
        return;
      }
      if (attempt === 1) say('info', p.state === 'sending' ? `Your reward for ${entry.owner}'s tag is on its way.` : `Your reward for ${entry.owner}'s tag is waiting: ${p.why}.`);
      if (Date.now() - began < 24 * 3600 * 1000) again(p.state === 'sending' && attempt < 20 ? 25_000 : 5 * 60_000);
    })
    .catch((e) => {
      log(`could not hand cash-in ${entry.id} to the site (${(e as Error).message}), attempt ${attempt}`);
      if (attempt < 8) again(attempt * 15000);
    });
}

/** every dog tag in what a player says they carry */
export function carriedTags(inv: SerializedInventory | null): ItemInstance[] {
  const out: ItemInstance[] = [];
  const walk = (it: ItemInstance | null | undefined) => {
    if (!it) return;
    if (it.id === 'dogtag') out.push(it);
    for (const p of it.cargo ?? []) walk(p.item);
  };
  if (!inv) return out;
  for (const it of Object.values(inv.slots)) walk(it);
  for (const cont of inv.containers) for (const it of cont.items) walk(it);
  return out;
}

/** Is one of these among what somebody carries? (a keycard, like a tag that was taken, goes on foot) */
export function carries(inv: SerializedInventory | null, id: string): boolean {
  let found = false;
  const walk = (it: ItemInstance | null | undefined) => {
    if (!it || found) return;
    if (it.id === id) found = true;
    for (const p of it.cargo ?? []) walk(p.item);
  };
  if (!inv) return false;
  for (const it of Object.values(inv.slots)) walk(it);
  for (const cont of inv.containers) for (const it of cont.items) walk(it);
  return found;
}

/** When each shooter last hit each body, and when their next hit on it is due (see `paced`, src/sim/hitclock.ts). */
export const hitsBy = new Map<number, Hits>();

export function mayHit(c: Client, target: string, now: number, gap: number): boolean {
  let m = hitsBy.get(c.id);
  if (!m) hitsBy.set(c.id, (m = new Map()));
  return paced(m, target, now, gap);
}

/** what a game says without anybody at it doing anything (see `handle`) */
export const SAID_BY_ITSELF = new Set<string>(['s', 'me', 'ping', 'gear', 'back', 'is', 'iatk', 'v', 'vrest']);

/** when each connection was last seen to carry a keycard, and how long after that it may still put one in the reader */
export const cardSeen = new Map<number, number>();

export const CARD_GRACE_MS = 20_000;

/**
 * The bunker's door. A keycard opens it; it stays open while anybody is inside (or stands in
 * its doorway), and shuts a minute after the last of them has gone.
 */
export const bunkerDoor = { open: false, /** when somebody was last inside, or the card was used */ emptyAt: 0 };
