// This browser's account at the store, and what it has (2026-10-22). The account is the hash of the key the page already
// keeps for the player's character (src/net/client.ts), made as the game server makes it (server/perks.ts): so what is
// bought is the character's, in this browser, as their gear is. What it has is asked of the site and kept an hour, so
// that the menu never waits on it before deciding whether to show an ad.

import { ACCT_SALT, NO_PERKS, type Perks } from '../../../api/_lib/shop-items';
import { playerKey } from '../../net/client';

const KEPT = 'zona.store.perks';
/** when this browser last bought: a game that starts soon after asks its server to look again (src/game/game/online.ts) */
export const BOUGHT = 'zona.store.bought';

let told: (() => void) | null = null;
/** the game's word to its server that this player has bought something (so their VIP shows without waiting) */
export const onBought = (f: () => void) => void (told = f);
export const bought = () => told?.();
const HOUR = 3_600_000;

let acct: Promise<string> | null = null;

export function myAcct(): Promise<string> {
  return (acct ??= (async () => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ACCT_SALT + playerKey()));
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  })());
}

function kept(a: string): { perks: Perks; at: number } | null {
  try {
    const k = JSON.parse(localStorage.getItem(KEPT) ?? 'null') as { acct: string; perks: Perks; at: number } | null;
    return k && k.acct === a ? k : null;
  } catch {
    return null;
  }
}

const heard: ((p: Perks) => void)[] = [];
/** told whenever what this account has is learnt afresh */
export const onPerks = (f: (p: Perks) => void) => void heard.push(f);

export async function setPerks(p: Perks) {
  const a = await myAcct();
  try {
    localStorage.setItem(KEPT, JSON.stringify({ acct: a, perks: p, at: Date.now() }));
  } catch {
    /* no storage: asked again next time */
  }
  for (const f of heard) f(p);
}

/** What this account has: kept for an hour, else asked of the site (nothing, where the site does not answer). */
export async function myPerks(fresh = false): Promise<Perks> {
  const a = await myAcct();
  const k = kept(a);
  if (k && !fresh && Date.now() - k.at < HOUR) return k.perks;
  try {
    const r = await fetch(`/api/store?acct=${a}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return k?.perks ?? NO_PERKS;
    const j = (await r.json()) as { perks: Perks };
    await setPerks(j.perks);
    return j.perks;
  } catch {
    return k?.perks ?? NO_PERKS;
  }
}
