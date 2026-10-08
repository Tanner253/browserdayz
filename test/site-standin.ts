// The site, standing on this machine, for trying the whole road by hand: the real
// api/cashin, api/tick and api/cashins code, with the made-up chain behind it (test/fake.ts)
// instead of Solana, moving on a block every 400 ms. Start the game server with SITE_URL
// pointing here and cash a tag in:
//
//   npx tsx test/site-standin.ts <port> <game server url> [treasury SOL]
//   SITE_URL=http://127.0.0.1:<port> CASH_HOLD_S=3 TAG_MIN_LIFE_S=2 PORT=8791 npx tsx server/index.ts
//
// GET /_state says what each wallet has received and how many transactions were handed in.

import http from 'node:http';
import { record } from '../api/cashin';
import { tick } from '../api/tick';
import { show } from '../api/cashins';
import { TREASURY, world } from './fake';

const PORT = Number(process.argv[2] ?? 8792);
const GAME = process.argv[3] ?? 'http://127.0.0.1:8791';
const w = world(Number(process.argv[4] ?? 1));
// here time is real time, and the chain keeps its own beat
w.now = Date.now;
w.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setInterval(() => w.chain.tick(1), 400).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const request = new Request(url, { method: req.method });
  try {
    let out: Response;
    if (url.pathname === '/api/cashin') out = await record(request, w, GAME);
    else if (url.pathname === '/api/tick') out = await tick(request, w);
    else if (url.pathname === '/payouts' || url.pathname === '/api/cashins') out = await show(request, w);
    else if (url.pathname === '/_state') {
      const balances = Object.fromEntries([...w.chain.balances].map(([k, v]) => [k === TREASURY.address ? 'treasury' : k, Number(v) / 1e9]));
      out = Response.json({ balances, handedIn: w.chain.handedIn.length, files: [...w.store.files.keys()] });
    } else out = new Response('not here', { status: 404 });
    const body = await out.text();
    if (url.pathname !== '/_state') console.log(new Date().toISOString().slice(11, 19), req.method, url.pathname + url.search, out.status, url.pathname === '/api/cashin' || url.pathname === '/api/tick' ? body.slice(0, 260) : `${body.length} bytes`);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(body);
  } catch (e) {
    console.log('failed:', (e as Error).message);
    res.writeHead(500).end(String((e as Error).message));
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`the stand-in site is on :${PORT}, asking the game server at ${GAME}; the treasury is ${TREASURY.address}`));
