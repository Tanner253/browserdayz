// What players have bought at the store (2026-10-22), as the site's who-has-what list says it (api/store.ts): VIP's
// place in the line and its purple tag, the cup by a coffee buyer's name, a gold dog tag, the finishes they may put on
// their guns (plates.ts).
// Asked of the site every five minutes, and soon after a player says they have just bought something (each answer
// comes from the site's cache: it costs the store nothing). Held by account, the hash of the player's key the store
// and the payouts both use (server/tags.ts). Nothing kept here: the site's book is the record.

import { createHash } from 'node:crypto';
import { ACCT_SALT, skinFor, type ItemId, type PerkList } from '../api/_lib/shop-items';
import { SITE_URL } from './tags';

/** where the store's list is asked for: the site, or a desk's own (a local dev page: .env.local-server). Asked when
 * wanted: tags.ts, whose SITE_URL it is, is still loading when this file is (tags -> players -> perks -> tags) */
export const storeUrl = () => process.env.STORE_URL ?? SITE_URL;
const EVERY_MS = 5 * 60_000;
/** after a purchase or a gift: asked fresh this long after (the owner, 2026-10-22: "5 sec buffer to middle ground it") */
const SOON_MS = 5_000;
/** and a glance's copy, up to a minute behind, taken for no more than that for so long after a fresh one */
const TRUST_FRESH_MS = 2 * 60_000;

export const acctOf = (key: string) => createHash('sha256').update(ACCT_SALT + key).digest('hex').slice(0, 24);
const accts = new Map<string, string>();
const acct = (key: string) => {
  let a = accts.get(key);
  if (!a) {
    if (accts.size > 20_000) accts.clear();
    accts.set(key, (a = acctOf(key)));
  }
  return a;
};

let list: PerkList = { at: 0, who: {} };
let asked = 0;
let soon: ReturnType<typeof setTimeout> | null = null;
let freshAt = 0;
let changed: (() => void) | null = null;

/** @param fresh read from the store's book as it is now (a counted read on the site), not its cached copy */
async function fetchList(fresh = false) {
  asked = Date.now();
  // (a glance soon after a fresh answer could be the copy from before the purchase: it would take the purchase away again)
  if (!fresh && asked - freshAt < TRUST_FRESH_MS) return;
  try {
    const r = await fetch(`${storeUrl()}/api/store?perks=1${fresh ? '&fresh=1' : ''}&t=${Math.floor(asked / 10_000)}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return;
    const next = (await r.json()) as PerkList;
    if (!next || typeof next.who !== 'object') return;
    const before = JSON.stringify(list.who);
    list = next;
    if (fresh) freshAt = Date.now();
    if (JSON.stringify(list.who) !== before) changed?.();
  } catch {
    /* the site did not answer: the last list holds */
  }
}

export const perks = {
  /** begun once the server is up; `onChange` re-tells players whose perks moved */
  start(onChange: () => void) {
    changed = onChange;
    void fetchList();
    setInterval(() => void fetchList(), EVERY_MS).unref();
  },
  /**
   * A player has just bought, or an admin has given or taken something: asked again, fresh, SOON_MS on (it was a glance
   * fifteen seconds on and another a minute on, the site's cached copy being up to a minute behind its book, so a gift
   * took up to a minute). Not more than once in SOON_MS: one asked for sooner waits for its turn, and is not dropped.
   */
  bought() {
    if (soon) return;
    soon = setTimeout(() => {
      soon = null;
      void fetchList(true);
    }, Math.max(SOON_MS, asked + SOON_MS - Date.now()));
    soon.unref();
  },
  vip(key: string, now = Date.now()) {
    return (list.who[acct(key)]?.[0] ?? 0) > now;
  },
  /** a coffee bought this week: a cup by their name */
  cup(key: string, now = Date.now()) {
    return (list.who[acct(key)]?.[2] ?? 0) > now;
  },
  skins(key: string): ItemId[] {
    return list.who[acct(key)]?.[3] ?? [];
  },
  /** their finish for a gun of this id, if they own one: the one asked for, or the first */
  skin(key: string, gun: string, want?: unknown): ItemId | null {
    return skinFor(this.skins(key), gun, want);
  },
  /** for a test: the list as given */
  set(next: PerkList) {
    list = next;
    changed?.();
  },
};
