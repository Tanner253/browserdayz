// Called by the game server when a dog tag has been held for its full time (thirty minutes), and
// again for as long as that tag has not been settled.
//
// The call carries only an id. This function asks the game server itself for that entry, so
// nobody can add a name to the payout list, or have a wallet paid, by calling this address:
// the game server is the only source of what was cashed in, and an id it does not know is
// turned away before anything else is done. The tag is then written in the book, which
// outlives the game server's restarts, and paid, if payouts are on: see _lib/payouts.ts.
// (A tag still unsettled when the game server restarts and forgets it is finished by the
// housekeeping, api/tick.ts, from the book.)

import { live } from './_lib/live.js';
import { handle, type Entry, type World } from './_lib/payouts.js';

const GAME = process.env.GAME_SERVER_URL ?? 'https://browserdayz.onrender.com';

export async function record(request: Request, w: World = live(), game = GAME): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[a-z0-9]{8,40}$/.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
  const r = await fetch(`${game}/cashins/${id}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r || !r.ok) return Response.json({ error: 'the game server does not know that cash-in' }, { status: 404 });
  const e = (await r.json()) as Record<string, unknown>;
  const entry: Entry = {
    id,
    at: String(e.at ?? new Date(w.now()).toISOString()).slice(0, 30),
    name: String(e.name ?? '').slice(0, 24),
    owner: String(e.owner ?? '').slice(0, 24),
    wallet: String(e.wallet ?? '').slice(0, 44),
    ...(typeof e.acct === 'string' && /^[0-9a-f]{8,64}$/.test(e.acct) ? { acct: e.acct } : {}),
  };
  const payout = await handle(w, entry);
  // A tag that waits for its wallet to have enough due (see dueOf in _lib/payouts.ts) is in the book, and is paid
  // from the book when the count is reached: there is nothing for the game server to ask about again. It was told
  // "3 of 5: ..." the first time. Asked again, it is answered with no payout at all, at which the game server
  // stops asking (it asks about a tag that is waiting every five minutes for a day: under the rule of five nearly
  // every tag waits, and that would be some three hundred calls for each of them).
  if (payout.state === 'waiting' && payout.parked) return Response.json({ ok: true, parked: payout }, { headers: { 'cache-control': 'no-store' } });
  // (paid at the top rate: the game server puts the Elite's crown by their name in its chat, see server/elite.ts)
  const top = payout.state === 'paid' && BigInt(payout.lamports) >= w.cfg.tagMax;
  return Response.json({ ok: true, payout, ...(top ? { top: true } : {}) }, { headers: { 'cache-control': 'no-store' } });
}

export const GET = (request: Request) => record(request);
export const POST = (request: Request) => record(request);
