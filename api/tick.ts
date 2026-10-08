// The housekeeping: goes back over the tags that are not settled yet (a payment still on its
// way, a tag waiting for the treasury or for tomorrow's limit) and collects the coin's
// creator rewards when enough are waiting. Run once a day by Vercel (see vercel.json) and
// by the game server after each tag is cashed in. Anybody may call it: all it can do is what
// would have been done anyway, and the answer is kept for a minute so that calling it over
// and over is calling it once.

import { live } from './_lib/live.js';
import { sweep, type World } from './_lib/payouts.js';

export async function tick(_request: Request, w: World = live()): Promise<Response> {
  const done = await sweep(w);
  return Response.json({ ok: true, mode: w.cfg.mode, ...done }, { headers: { 'cache-control': 'public, s-maxage=60' } });
}

export const GET = (request: Request) => tick(request);
