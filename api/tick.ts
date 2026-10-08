// The housekeeping: collects the coin's creator rewards when enough are waiting, and goes
// back over the tags that are not settled yet (a payment still on its way, a tag waiting for
// the treasury or for tomorrow's limit).
//
// Nothing has to remember to run it. The game and the payouts page call it whenever somebody
// is looking and there is something to collect; the game server calls it while anybody is
// playing; and Vercel calls it once a day (see vercel.json). Anybody may call it: all it can
// do is what would have been done anyway, and however often it is called it runs at most
// twice a minute.
//
//   ?check=store   tries the file store's promises once (see check in _lib/store.ts) and
//                  shows what came of it from then on

import { live } from './_lib/live.js';
import { cached, sweep, type World } from './_lib/payouts.js';
import { check } from './_lib/store.js';

const CHECK = 'ledger/check/3';

async function checkOnce(w: World): Promise<unknown> {
  const done = await w.store.glance(`${CHECK}/result.json`).catch(() => null);
  if (done) return done;
  // (whoever is first to say so runs it; everybody else is told it is under way)
  if ((await w.store.swap(`${CHECK}/began.json`, { at: new Date(w.now()).toISOString() }, null)) === false) return { note: 'begun: what came of it is shown here when it is done' };
  const result = await check(w.store, CHECK, w.sleep);
  await w.store.swap(`${CHECK}/result.json`, result, null);
  return result;
}

export async function tick(request: Request, w: World = live()): Promise<Response> {
  if (new URL(request.url).searchParams.get('check') === 'store') return Response.json(await checkOnce(w), { headers: { 'cache-control': 'no-store' } });
  const done = await cached(w, 'tick', 30_000, () => sweep(w));
  return Response.json({ ok: true, mode: w.cfg.mode, ...done }, { headers: { 'cache-control': 'public, s-maxage=30' } });
}

export const GET = (request: Request) => tick(request);
