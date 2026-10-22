// A player's name and payout wallet are fixed at their first cashed tag (the owner, 2026-10-22: "we should prevent a user
// from changing their wallet and username once they cash in their first tag. admin can allow user to change from admin
// panel"). By the hash of their key, kept with the world (keep.ts), so a restart changes nothing. A wallet first given
// after that first tag is fixed at the first tag it is given with. An admin's /unlock frees both: they are fixed again,
// as they are then, at the next cashed tag.

import { createHash } from 'node:crypto';

/** gate.ts's keyHash, the same words, here so that this file stands alone (gate.ts brings the whole server with it) */
const keyHash = (key: string) => createHash('sha256').update(`zona key ${key}`).digest('hex').slice(0, 40);

export interface Pin {
  name: string;
  /** '' until a tag is cashed with a wallet given */
  wallet: string;
  at: number;
}

const pins = new Map<string, Pin>();

export const pinned = {
  of(key: string): Pin | undefined {
    return pins.get(keyHash(key));
  },
  /** At a tag cashed for a reward: fixes what is not fixed yet. @returns the pin that holds, and whether this made it */
  cash(key: string, name: string, wallet: string): { pin: Pin; fresh: boolean } {
    const k = keyHash(key), had = pins.get(k);
    if (had && (had.wallet || !wallet)) return { pin: had, fresh: false };
    const pin = had ? { ...had, wallet } : { name, wallet, at: Date.now() };
    pins.set(k, pin);
    return { pin, fresh: true };
  },
  /** an admin's unlock, of a player who is on (by key) @returns whether there was anything to free */
  free(key: string): boolean {
    return pins.delete(keyHash(key));
  },
  /** the same for one who is not on, by the name they are fixed to (one of the name only) @returns the name freed, or null */
  freeName(name: string): string | null {
    const low = name.toLowerCase(), hits = [...pins].filter(([, p]) => p.name.toLowerCase() === low);
    if (hits.length !== 1) return null;
    pins.delete(hits[0][0]);
    return hits[0][1].name;
  },
  keep(): [string, Pin][] {
    return [...pins];
  },
  /** what was kept (or a copy that turned up late): one fixed here already stands */
  restore(kept?: [string, Pin][]) {
    for (const [k, p] of kept ?? []) if (!pins.has(k) && p && typeof p.name === 'string') pins.set(k, { name: p.name, wallet: typeof p.wallet === 'string' ? p.wallet : '', at: Number(p.at) || 0 });
  },
};
