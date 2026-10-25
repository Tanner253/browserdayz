// The server: the trader camp (progression v3; the rules are src/sim/camp.ts and src/sim/jobs.ts). Every trade judged
// here, on the server's own copy of the pockets, at the stall's counter: scrap taken as building's costs are ('spent'),
// a thing sold by its number, what is bought given as the server's own (so that nothing is minted: the navigator,
// "Server-checked, so nothing is minted"). Each player's day (what was bought, what was paid for things sold, the jobs
// paid, the infected put down) is kept by their key's hash, in the save, so a restart gives nobody a second day; and the
// old book is paid out once a player. Within the camp's safe zone nobody is hurt by anybody (handle.ts asks `safe`).

import type { C2S, TradeDay } from '../src/net/protocol';
import { CAMP, STALL_IDS, bookScrap, dayFor, inSafe, mayBuy, maySell, type StallId } from '../src/sim/camp';
import { dayOf, mayHandIn } from '../src/sim/jobs';
import { pocketsOf, count } from '../src/sim/craft/plan';
import { MAT } from '../src/sim/craft/materials';
import { ITEMS, itemName } from '../src/sim/items';
import { send, type Client } from './players';
import { KEPT } from './keep';
import { log, things, world } from './index';
import { pay } from './build';
import { give } from './craft';
import { refuse } from './searched';
import { keyHash } from './gate';

const days = new Map<string, TradeDay>();
/** whose old book has been paid out, by key hash */
const booked = new Set<string>();

const dayOfC = (c: Client) => dayFor(dayOf(Date.now()), days.get(keyHash(c.key)));
const keepDay = (c: Client, d: TradeDay) => {
  days.set(keyHash(c.key), d);
  KEPT.dirty = true;
  send(c, { t: 'tday', day: d });
};

/** their game told their day at the camp */
export const tellDay = (c: Client) => send(c, { t: 'tday', day: dayOfC(c) });

/** whether a place is within the camp's safe zone */
export const safe = (x: number, z: number) => inSafe(world.camp, x, z);

/** an infected put down by a player: counted toward the day's jobs */
export function campKill(c: Client, head: boolean) {
  const d = dayOfC(c);
  d.kills++;
  if (head) d.heads++;
  keepDay(c, d);
}

export function trade(c: Client, m: Extract<C2S, { t: 'trade' }>) {
  const s = STALL_IDS.includes(m.s as StallId) ? (m.s as StallId) : null, spot = s && world.camp?.stalls.find((x) => x.id === s);
  if (!c.alive || !s || !spot) return;
  const no = (say: string) => send(c, { t: 'trade', ok: false, say });
  if (Math.hypot(spot.at[0] - c.pose[0], spot.at[2] - c.pose[2]) > CAMP.reach + 1) return void no('Come up to the counter.');
  const d = dayOfC(c), all = pocketsOf(c.inv).all;
  if (m.op === 'buy' && typeof m.id === 'string') {
    const good = mayBuy(s, m.id, d, count(all, MAT.scrap));
    if (typeof good === 'string') return void no(good);
    pay(c, { [MAT.scrap]: good.price });
    give(c, good.id, good.n);
    d.bought[good.id] = (d.bought[good.id] ?? 0) + 1;
    keepDay(c, d);
    return void send(c, { t: 'trade', ok: true, say: `${ITEMS[good.id].name}. Mind how you go.` });
  }
  if (m.op === 'sell' && typeof m.u === 'string') {
    const it = [...things(c.inv)].find((x) => x.uid === m.u);
    if (!it || it.id === 'dogtag') return void no('You have not got that on you.');
    const got = maySell(s, it, d);
    if (typeof got === 'string') return void no(got);
    refuse(c, [it.uid]);
    give(c, MAT.scrap, got);
    d.sold += got;
    keepDay(c, d);
    return void send(c, { t: 'trade', ok: true, say: `${got} for the ${itemName(it).toLowerCase()}.`, used: [it.uid] });
  }
  if (m.op === 'job' && typeof m.id === 'string' && s === 'building') {
    const job = mayHandIn(m.id, d, (id) => count(pocketsOf(c.inv).free, id));
    if (typeof job === 'string') return void no(job);
    if (job.kind === 'bring') pay(c, { [job.item!]: job.n });
    d.done.push(job.id);
    give(c, MAT.scrap, job.pays);
    keepDay(c, d);
    return void send(c, { t: 'trade', ok: true, say: `That is the job done. ${job.pays} scrap.` });
  }
}

/** the old trader's book, as their browser kept it, paid out in scrap: once a player */
export function book(c: Client, m: Extract<C2S, { t: 'book' }>) {
  const k = keyHash(c.key), n = bookScrap(m.n);
  if (!c.alive || booked.has(k) || n <= 0) return;
  booked.add(k);
  KEPT.dirty = true;
  give(c, MAT.scrap, n);
  send(c, { t: 'tell', kind: 'good', text: `The trader has paid out what was in his old book: ${n} scrap` });
  log(`[camp] ${c.name}'s old credit of ${Math.floor(m.n)} paid out as ${n} scrap`);
}

/** for the save: today's days and whose books are paid */
export const keepCamp = () => {
  const today = dayOf(Date.now());
  return { days: [...days].filter(([, d]) => d.day === today), books: [...booked] };
};

/** read back from the save */
export function restoreCamp(kept: unknown) {
  const k = kept as { days?: unknown; books?: unknown } | undefined;
  if (Array.isArray(k?.days)) for (const e of k.days) if (Array.isArray(e) && typeof e[0] === 'string') days.set(e[0], dayFor(dayOf(Date.now()), e[1] as Partial<TradeDay>));
  if (Array.isArray(k?.books)) for (const b of k.books) if (typeof b === 'string') booked.add(b);
}
