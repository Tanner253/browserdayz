// The Elite: players whose last payout was at the top rate, each held by their key's hash (nobody's anything), with a
// crown by their name in chat (the owner, 2026-10-15: "we should show the elite icon in the chat next to player names,
// and when hovered on it says something honorable about the player"). The site says which payouts were at the top
// rate (api/cashin.ts, `top`), so the crown goes to the key that cashed the tags in, never to a wallet anybody could
// type; a later payout below the top rate (they have sold) takes it off. Kept with the world (keep.ts).

import { keyHash } from './gate';

const crowned = new Map<string, number>();

export const elite = {
  has(key: string) {
    return crowned.has(keyHash(key));
  },
  /** a payout of theirs has been made: at the top rate or not */
  paid(key: string, top: boolean) {
    if (top) crowned.set(keyHash(key), Date.now());
    else crowned.delete(keyHash(key));
  },
  keep(): [string, number][] {
    return [...crowned];
  },
  /** what was kept (or a copy that turned up late): the later mark of the two wins */
  restore(list: unknown) {
    if (!Array.isArray(list)) return;
    for (const e of list) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[1] !== 'number') continue;
      crowned.set(e[0], Math.max(crowned.get(e[0]) ?? 0, e[1]));
    }
  },
};
