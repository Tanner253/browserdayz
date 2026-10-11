// What the game server must not forget between its restarts: everybody's character, and every stash (2026-10-12).
//
// The game server keeps nothing itself (it has no disk that outlasts it), so what it must not forget it hands to
// this, which puts it in one file beside the payout book (Vercel Blob). What is handed over is sealed by the game
// server before it leaves it: this function could not read it if it tried, and neither can anybody who comes by
// the file. It says only when it was written, by which run of the server, and whether that was the run's last word.
//
// Called by the game server only. It is known for the game server by a secret the two share: the one drawn from
// the admin password (see api/admin.ts), which the game server was given when it first proved itself there. Every
// call is signed with it, over what is sent and the minute it is sent in. (Not proved by calling the game server
// back, as a cash-in is: at a deploy there are two game servers alive for a moment, and a call back reaches only
// the new one, while it is the old one that has the last word to hand over.)
//
// Written when a server with players on it starts keeping, every few hours while it runs, and as it stops: a few
// writes a day. (The store allows two thousand a month, and the payouts need them: see _lib/store.ts.)

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { pepperOf } from './admin.js';
import { blobStore, type Store } from './_lib/store.js';

const FILE = 'zona/world.json';

export interface Kept {
  /** when it was written, and by which run of the game server */
  at: string;
  boot: string;
  /** that run's last word: it has stopped, and nothing newer is coming from it */
  final: boolean;
  /** what is kept, sealed */
  z: string;
}

/** the signature a call carries: over the moment it was made and what it says */
export const keepAuth = (pepper: string, at: string, body: string) => createHmac('sha256', `zona keep ${pepper}`).update(`${at}.${createHash('sha256').update(body).digest('hex')}`).digest('hex');

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, max);
const none = { headers: { 'cache-control': 'no-store' } };

export async function keep(request: Request, store: Store = blobStore, env: Record<string, string | undefined> = process.env): Promise<Response> {
  const secret = env.ADMIN_PASSWORD ?? '';
  if (!secret) return Response.json({ error: 'nothing is kept: no admin password is set' }, { status: 503 });
  const body = await request.text();
  if (body.length > 4_000_000) return Response.json({ error: 'too much to keep' }, { status: 413 });
  const at = request.headers.get('x-zona-at') ?? '', sig = request.headers.get('x-zona-auth') ?? '';
  if (!/^\d{13}$/.test(at) || Math.abs(Date.now() - Number(at)) > 5 * 60_000 || !same(sig, keepAuth(pepperOf(secret), at, body))) return Response.json({ error: 'not the game server' }, { status: 403 });
  let op: { op?: string; at?: string; boot?: string; final?: boolean; z?: string };
  try {
    op = JSON.parse(body);
  } catch {
    return Response.json({ error: 'not understood' }, { status: 400 });
  }
  const held = await store.read<Kept>(FILE);
  if (op.op === 'load') return Response.json({ ok: true, save: held?.data ?? null }, none);
  if (op.op === 'save') {
    if (typeof op.z !== 'string' || !op.z || !/^[A-Za-z0-9+/=]+$/.test(op.z)) return Response.json({ error: 'nothing to keep' }, { status: 400 });
    const next: Kept = { at: text(op.at, 30), boot: text(op.boot, 32), final: !!op.final, z: op.z };
    if ((await store.swap(FILE, next, held?.mark ?? null)) === false) return Response.json({ ok: false, why: 'it was being written by something else: try again' }, none);
    return Response.json({ ok: true }, none);
  }
  return Response.json({ error: 'no such thing to do' }, { status: 400 });
}

export const POST = (request: Request) => keep(request);
