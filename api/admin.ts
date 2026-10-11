// Who may give orders on the game server, and who is kept off it: kept where a restart of the game server does
// not lose it (2026-10-11).
//
// The game server keeps nothing between restarts, so the list of admins and the list of bans live here, in one
// small file beside the payout book (Vercel Blob). The password that makes somebody an admin is ADMIN_PASSWORD
// in this site's settings and is known to nothing else: the game server passes on what a player typed, and this
// says yes or no.
//
// Called by the game server only, and proved the same way a cash-in is (api/cashin.ts): the call carries a
// number and nothing else, and this function asks the game server itself what that number stands for. Nobody
// else can have the game server vouch for a number, so nobody else can log in, read the lists or write them.
//
// What is kept is not anybody's address or anybody's key as such. A player's key is kept as a hash of it. An
// address is kept as a hash made with a secret drawn from the password (the "pepper"), which is handed to the
// game server so that it can tell whether somebody arriving is on the list: without it the hashes say nothing
// of where anybody plays from.
//
// The file is written only when an admin changes something: a ban, an unban, a role. (The store allows two
// thousand writes a month, and the payouts need them: see _lib/store.ts.)

import { createHmac, timingSafeEqual } from 'node:crypto';
import { blobStore, type Store } from './_lib/store.js';

const GAME = process.env.GAME_SERVER_URL ?? 'https://browserdayz.onrender.com';
const FILE = 'zona/admin.json';

export type Role = 'admin' | 'mod';
export interface AdminState {
  /** by the hash of a player's key */
  roles: Record<string, { role: Role; name: string; by: string; at: string }>;
  bans: { key: string; ip: string; name: string; why: string; by: string; at: string }[];
}
const EMPTY: AdminState = { roles: {}, bans: [] };

const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, max);
const hash = (v: unknown) => (/^[a-f0-9]{16,64}$/.test(String(v)) ? String(v) : '');

/** what is taken of a list the game server sends: nothing but what a list holds, and no more of it than is sane */
function clean(s: unknown): AdminState {
  const src = (s ?? {}) as Partial<AdminState>;
  const roles: AdminState['roles'] = {};
  for (const [k, v] of Object.entries(src.roles ?? {}).slice(0, 200)) {
    if (!hash(k) || !v || (v.role !== 'admin' && v.role !== 'mod')) continue;
    roles[k] = { role: v.role, name: text(v.name, 24), by: text(v.by, 24), at: text(v.at, 30) };
  }
  const bans = (Array.isArray(src.bans) ? src.bans : []).slice(0, 2000).flatMap((b) => {
    const key = hash(b?.key), ip = hash(b?.ip);
    return key || ip ? [{ key, ip, name: text(b.name, 24), why: text(b.why, 120), by: text(b.by, 24), at: text(b.at, 30) }] : [];
  });
  return { roles, bans };
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function admin(request: Request, store: Store = blobStore, game = GAME, env: Record<string, string | undefined> = process.env): Promise<Response> {
  const n = new URL(request.url).searchParams.get('n') ?? '';
  if (!/^[a-f0-9]{32}$/.test(n)) return Response.json({ error: 'bad number' }, { status: 400 });
  const r = await fetch(`${game}/adminop/${n}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r || !r.ok) return Response.json({ error: 'the game server does not know that number' }, { status: 404 });
  const op = (await r.json()) as { op?: string; pw?: string; key?: string; name?: string; state?: unknown };
  const secret = env.ADMIN_PASSWORD ?? '';
  // (drawn from the password and never the password: what the game server hashes addresses with)
  const pepper = secret ? createHmac('sha256', secret).update('zona address pepper').digest('hex') : '';
  const none = { headers: { 'cache-control': 'no-store' } };
  const held = await store.read<AdminState>(FILE);
  const state = clean(held?.data ?? EMPTY);

  if (op.op === 'load') return Response.json({ ok: true, state, pepper, set: !!secret }, none);

  if (op.op === 'login') {
    if (!secret) return Response.json({ ok: false, why: 'No admin password is set on the site yet.' }, none);
    if (!same(text(op.pw, 200), secret)) return Response.json({ ok: false, why: 'That is not the password.' }, none);
    const key = hash(op.key);
    if (!key) return Response.json({ ok: false, why: 'Your game gave no key.' }, none);
    if (state.roles[key]?.role !== 'admin') {
      state.roles[key] = { role: 'admin', name: text(op.name, 24), by: 'password', at: new Date().toISOString() };
      if ((await store.swap(FILE, state, held?.mark ?? null)) === false) return Response.json({ ok: false, why: 'The list was being written by something else: try again.' }, none);
    }
    return Response.json({ ok: true, state, pepper }, none);
  }

  if (op.op === 'save') {
    const next = clean(op.state);
    if ((await store.swap(FILE, next, held?.mark ?? null)) === false) return Response.json({ ok: false, why: 'The list was being written by something else: try again.' }, none);
    return Response.json({ ok: true, state: next, pepper }, none);
  }
  return Response.json({ error: 'no such thing to do' }, { status: 400 });
}

export const POST = (request: Request) => admin(request);
