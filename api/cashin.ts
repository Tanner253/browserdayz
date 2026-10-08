// Called by the game server when a dog tag has been held for the full ten minutes, and
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
  };
  const payout = await handle(w, entry);
  return Response.json({ ok: true, payout }, { headers: { 'cache-control': 'no-store' } });
}

export const GET = (request: Request) => record(request);
export const POST = (request: Request) => record(request);
