// Called by the game server when a dog tag has been held for the full ten minutes.
// The call carries only an id. This function then asks the game server itself for that
// entry, so nobody can add a name to the payout list by calling this address: the game
// server is the only source of what was cashed in. The entry is kept in Vercel Blob, where
// it outlives the game server's restarts (it has no disk of its own).

import { put } from '@vercel/blob';

const GAME = process.env.GAME_SERVER_URL ?? 'https://browserdayz.onrender.com';

async function record(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[a-z0-9]{8,40}$/.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
  const r = await fetch(`${GAME}/cashins/${id}`, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return Response.json({ error: 'the game server does not know that cash-in' }, { status: 404 });
  const e = (await r.json()) as Record<string, unknown>;
  const entry = {
    id,
    at: String(e.at ?? new Date().toISOString()).slice(0, 30),
    name: String(e.name ?? '').slice(0, 24),
    owner: String(e.owner ?? '').slice(0, 24),
    wallet: String(e.wallet ?? '').slice(0, 44),
  };
  // one small file per cash-in: nothing to lose if two arrive at once
  await put(`cashins/${entry.at.replace(/[^0-9TZ-]/g, '-')}_${id}.json`, JSON.stringify(entry), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  return Response.json({ ok: true });
}

export const GET = record;
export const POST = record;
