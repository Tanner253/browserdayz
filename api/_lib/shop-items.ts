// What the store sells (2026-10-22), read by the site's check (shop.ts), the store's page (src/ui/store/) and the game
// server (server/perks.ts). No imports: all three take it as it is. The owner: "we offer a VIP membership for 5$ a month
// optional (sol) ... and a gold plated desert eagle for 4.99 (sol)", and yes to no-ads alone, the three other finishes
// and the gold dog tag in VIP. Cosmetic and convenience only: a finish only ever makes a gun easier to see, never harder.

export type ItemId = 'vip' | 'noads' | 'deagle_gold' | 'm9_nickel' | 'colt_nickel' | 'knife_gold' | 'coffee';

export interface ShopItem {
  name: string;
  /** dollars; 0 for the coffee, whose amount the buyer picks */
  usd: number;
  /** a perk that runs out: each payment adds this many days to what is left */
  days?: number;
  /** a finish on one of the game's own models, by its item id (src/sim/items.ts): numbered, each one sold its own */
  skin?: { gun: string; finish: 'gold' | 'nickel' };
  /** how many will ever be sold (the owner, 2026-10-22: "we will make these items nft's in the future so each cosmetic sold should be reserved. we will only sell 100 gold deagles and 100 gold knives") */
  limit?: number;
  say: string;
}

export const SHOP: Record<ItemId, ShopItem> = {
  vip: { name: 'VIP', usd: 5, days: 30, say: 'Queue pass, [VIP] in purple in chat and on the board, the VIP role and channel on Discord, no ads, and a gold dog tag.' },
  deagle_gold: { name: 'Gold-plated Desert Eagle', usd: 4.99, limit: 100, skin: { gun: 'deagle', finish: 'gold' }, say: 'Every Desert Eagle you find is gold-plated, as everybody sees it.' },
  m9_nickel: { name: 'Nickel-plated M9', usd: 2.99, skin: { gun: 'm9', finish: 'nickel' }, say: 'Every M9 you find is nickel-plated.' },
  colt_nickel: { name: 'Nickel-plated Colt', usd: 2.99, skin: { gun: 'colt', finish: 'nickel' }, say: 'Every Colt you find is nickel-plated.' },
  knife_gold: { name: 'Gold knife', usd: 4.99, limit: 100, skin: { gun: 'knife', finish: 'gold' }, say: 'Every knife you find has a gold blade.' },
  noads: { name: 'No ads', usd: 1.99, days: 30, say: 'The site and the game with no ads (VIP has this too).' },
  coffee: { name: 'Buy the dev a coffee', usd: 0, say: 'Any amount, with a note if you like. A cup by your name in chat for a week.' },
};

export const ITEM_IDS = Object.keys(SHOP) as ItemId[];
export const isItem = (v: unknown): v is ItemId => typeof v === 'string' && v in SHOP;

/** the coffee's amounts in dollars: the least, the most, and the three offered */
export const COFFEE = { min: 1, max: 1000, picks: [3, 5, 10] };
/** how long a quote's price holds, ms */
export const QUOTE_MS = 30 * 60_000;
/** how long a coffee's cup stays by the buyer's name, days */
export const CUP_DAYS = 7;

/** what one account has, each perk as the moment it runs out (ms, 0: none) */
export interface Perks {
  vip: number;
  noads: number;
  cup: number;
  /** the finishes they own, by item id */
  skins: ItemId[];
}

/** the who-has-what list the game servers and pages read: by account, [vip, noads, cup, skins] */
export interface PerkList {
  at: number;
  who: Record<string, [number, number, number, ItemId[]]>;
}

export const NO_PERKS: Perks = { vip: 0, noads: 0, cup: 0, skins: [] };

/** a player's account as the store and the payouts know it: from the key their browser keeps (server/tags.ts makes it the same way) */
export const ACCT_SALT = 'ZONA player ';
export const isAcct = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/.test(v);

/** whether ads are kept from this account now: VIP or no-ads running */
export const adFree = (p: Perks, now = Date.now()) => p.vip > now || p.noads > now;

/** the finish a player's gun of this id wears, if they own one */
export function finishOf(skins: readonly string[], gun: string): 'gold' | 'nickel' | null {
  for (const id of skins) {
    const s = (SHOP as Record<string, ShopItem>)[id]?.skin;
    if (s && s.gun === gun) return s.finish;
  }
  return null;
}
